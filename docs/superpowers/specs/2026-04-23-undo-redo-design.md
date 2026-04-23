# Undo / Redo — Design

**Date:** 2026-04-23
**Scope:** A reusable, modular undo/redo primitive for the NetraRT app, wired to canvas object mutations: drag-move, delete, upload (drop), duplicate. Soft-delete on PocketBase so undo of a delete does not require re-upload.
**Non-goals:** Undo/redo for stack reorder (`bringToFront`), view/pan/zoom, selection, highlight-input text, SAM3 segmentation results, settings changes.

## Goal

Users on the infinite canvas can reverse and re-apply object-state mutations with the platform-standard shortcuts (`Cmd/Ctrl-Z`, `Cmd/Ctrl-Shift-Z`, `Cmd/Ctrl-Y`). The implementation is split into a generic history primitive that knows nothing about canvas, PocketBase, or React state shape, plus a thin canvas-specific layer that builds entries for each action kind. The history primitive is reusable for any future mutating surface in the app (e.g., segmentation edits, settings audit trail).

## Success criteria

1. `Cmd/Ctrl-Z` reverses the most recent drag, delete, or upload; `Cmd/Ctrl-Shift-Z` (and `Cmd/Ctrl-Y`) re-applies it. Works at both the single-item and multi-selection level.
2. Undo of a delete does **not** require re-uploading the file. The PocketBase record's id is preserved across delete → undo → redo cycles. Undoing then segmenting the restored image is instant (SAM3 cache is not invalidated on soft-delete).
3. The generic `useHistory` hook lives in `apps/app/src/lib/history/` and has no imports from `Canvas.tsx`, `lib/pb.ts`, or any other feature module.
4. Unit tests cover the primitive's push / undo / redo / eviction / future-clear / async-ordering / error-propagation paths.
5. Soft-deleted PocketBase records are hard-deleted automatically via two triggers: (a) eviction from the history stack, (b) a launch-time sweep that purges records soft-deleted more than 1 hour ago.
6. Shortcuts respect typing context — typing in the highlight input, search palette, or settings modal does not trigger undo/redo.
7. Canvas.tsx grows by roughly 150 lines (push sites + mount-time sweep hook), not by a large inline history implementation. All new logic lives in dedicated modules.

## Non-goals

- No undo for implicit side-effects of selection or drag (e.g., `bringToFront` stack reordering). Those fire on virtually every pointer-down and making them undoable would flood the stack with meaningless entries.
- No undo for view state (pan, zoom), selection set, hover, marquee, upload progress, segmentation prompts or results, or settings.
- No branching history, no redo-across-branches, no persistence of the undo stack across app launches. History is in-memory per session.
- No visible trash UI or manual "Empty Trash" control in v1. Hard-delete is automatic.
- No refactor of `Canvas.tsx`. Canvas stays a single file; only the isTypingContext helper is lifted out because it's shared with the new shortcuts hook.

## Architecture

Five surfaces touched:

- **`apps/app/src/lib/history/`** (new) — generic hook and shortcuts binding. Exports:
  - `useHistory<M>(opts?)` — the core primitive.
  - `useHistoryShortcuts(history)` — `Cmd/Ctrl-Z` / `Cmd/Ctrl-Shift-Z` / `Cmd/Ctrl-Y` binding.
  - `HistoryEntry<M>` type.
- **`apps/app/src/lib/dom/isTypingContext.ts`** (new, lifted) — pure predicate shared by the existing Delete/Backspace keybind and the new undo shortcuts.
- **`apps/app/src/lib/canvasHistory.ts`** (new) — builders for the four canvas action kinds. Each builder returns a `HistoryEntry<CanvasActionMeta>` with `do`, `undo`, and `onEvict` closures.
- **`apps/app/src/lib/pb.ts`** — extended with soft-delete semantics. `deleteImage` / `deleteVideo` become soft (update `deleted_at`). New exports: `restoreImage`, `restoreVideo`, `hardDeleteImage`, `hardDeleteVideo`, `listTrashed`. `listImages` / `listVideos` filter out soft-deleted records.
- **`apps/app/src/Canvas.tsx`** — calls `useHistory`, `useHistoryShortcuts`, runs a mount-time sweep, and pushes entries at four commit sites.

Plus one schema migration:

- **`pb/pb_migrations/<timestamp>_add_deleted_at.js`** — adds nullable `deleted_at` (date) field to `images` and `videos`.

No changes to `InfiniteCanvas`, `MediaToolbar`, `SearchPalette`, `ContextMenu`, `FloatingSidebar`, `HighlightInput`, the Tauri Rust side, or SAM3 integration (beyond the existing `sam3_delete_image_cache` invocation moving from soft-delete to hard-delete sites).

## Core types

```ts
// lib/history/types.ts
export type HistoryEntry<M = unknown> = {
  /** Re-apply the action. Called on redo, and on push when alreadyApplied is false. */
  do: () => void | Promise<void>;
  /** Revert the action. Called on undo. */
  undo: () => void | Promise<void>;
  /** Fired when this entry leaves both the past and future stacks permanently
   *  (limit overflow or future-clear on new push). Use for committing to
   *  operations that were deferred while the entry was undoable — e.g., a
   *  soft-deleted record's hard-delete. */
  onEvict?: () => void | Promise<void>;
  /** Human-readable label. Used for dev logs and any future toast UI. */
  label: string;
  /** Free-form metadata for consumers. The history hook never reads this. */
  meta?: M;
};

// lib/history/useHistory.ts
export type HistoryController<M = unknown> = {
  push: (entry: HistoryEntry<M>, opts?: { alreadyApplied?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export type UseHistoryOptions = {
  /** Max size of the `past` stack. Excess entries are evicted FIFO. Default 100. */
  limit?: number;
  /** Called when an entry's own onEvict throws or when do/undo rejects. */
  onError?: (err: unknown, phase: 'do' | 'undo' | 'evict') => void;
};

export function useHistory<M = unknown>(
  opts?: UseHistoryOptions,
): HistoryController<M>;
```

Key property: `push(entry, { alreadyApplied: true })` records the entry **without** calling `do()`. This is what lets us retrofit the existing Canvas event handlers — they already optimistically mutate state and fire off the PocketBase call, so at the commit point they just hand a ticket to the history layer. Without this flag, every mutation path would need to be rewritten to flow through a dispatcher.

## Canvas action builders

```ts
// lib/canvasHistory.ts
type CanvasActionMeta =
  | { kind: 'move'; ids: string[] }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'create'; ids: string[] };

type SetMedia = React.Dispatch<React.SetStateAction<CanvasMedia[]>>;

export function moveEntry(args: {
  moves: Array<{
    id: string;
    kind: MediaKind;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }>;
  setMedia: SetMedia;
  onConn: (c: 'ready' | 'offline') => void;
}): HistoryEntry<CanvasActionMeta>;

export function deleteEntry(args: {
  deleted: CanvasMedia[];                     // full snapshots at delete time
  setMedia: SetMedia;
  onConn: (c: 'ready' | 'offline') => void;
}): HistoryEntry<CanvasActionMeta>;

export function createEntry(args: {
  created: CanvasMedia[];                     // resolved records only (not pending)
  setMedia: SetMedia;
  onConn: (c: 'ready' | 'offline') => void;
}): HistoryEntry<CanvasActionMeta>;
```

Each builder closes over the callbacks it needs; no `this`, no registry, no class hierarchy. The return shape is just `HistoryEntry<CanvasActionMeta>`, so the history hook stays fully generic.

## Per-action flow

### Move (drag)

Today: `handleMediaPointerMove` mutates `media` optimistically via `setMedia`. `handleMediaPointerUp` calls `updateImagePosition` / `updateVideoPosition` for every dragged item using `orig` (the per-id starting position) and `lastDx` / `lastDy`.

Change: at the end of `handleMediaPointerUp`, if `moved`, build a `moveEntry` from the same `orig` map and the current positions and push it with `{ alreadyApplied: true }`. Pending items are filtered out (their server record doesn't exist yet).

- `undo()` sets each `id` back to `from` locally and re-runs `updateImage/VideoPosition(id, from)`.
- `do()` sets each `id` to `to` locally and re-runs `updateImage/VideoPosition(id, to)`.
- `onEvict`: none. Moves have no deferred commitment.
- One drag = one entry. No real-time coalescing required; pointerup is already the natural commit.

### Delete

Today: `deleteMediaById` removes locally and calls `deleteImage` / `deleteVideo` (which hard-deletes in PB), then invokes `sam3_delete_image_cache` for images.

Change:

1. `deleteImage` / `deleteVideo` become soft — they `update(id, { deleted_at: now })`.
2. `deleteMediaById` no longer calls `sam3_delete_image_cache` on success. That call moves to the hard-delete sites.
3. After a successful soft-delete, push a `deleteEntry` with the pre-delete snapshots.

- `undo()` calls `restoreImage/Video(id)` and re-inserts each snapshot into local `media` at the end. (The sidebar shows `media` in insertion order, so this "append on restore" behavior is acceptable and matches typical undo semantics — restored items are visually "re-added.")
- `do()` re-runs the soft-delete on each id (`deleteImage/Video`) and removes locally.
- `onEvict` calls `hardDeleteImage/Video(id)` for each id, then `sam3_delete_image_cache(id)` for images. Failures log and swallow; the launch sweep will pick them up.
- Ids are stable across the delete → undo → redo cycle, so no id remapping is needed. Subsequent entries referencing the same id continue to work.

### Create (drop / duplicate)

Today: `runUploadPlan` inserts a pending draft into `media`, starts the upload, and on resolve replaces the draft with the server record. On error, the pending entry stays with a `phase: 'error'` status; no history interaction.

Change: when the upload resolves successfully, push a `createEntry` with the resolved `CanvasMedia` (`setMedia` has already been updated). Pending and errored items do **not** produce history entries — there is nothing server-side to undo.

- `undo()` calls `deleteImage/Video(id)` (soft-delete) and removes locally.
- `do()` calls `restoreImage/Video(id)` and re-inserts.
- `onEvict` calls `hardDeleteImage/Video(id)` + `sam3_delete_image_cache(id)` for images.

This means `Cmd-Z` immediately after dropping a file does nothing visible until the upload resolves. Acceptable for v1 — aborting an in-flight upload is already supported via the manual cancel path on the upload status chip (if present) or automatically when the item is deleted via Delete/Backspace.

## Hard-delete triggers

Two independent mechanisms guarantee every soft-deleted record is eventually hard-deleted:

1. **History eviction.** `useHistory` fires `onEvict` when an entry leaves both `past` and `future` permanently. That happens in three ways:
   - The entry is the oldest in `past` and `past.length` exceeds `limit` on a new push.
   - The entry is in `future` and a new entry is pushed (classic linear-history future clear).
   - The controller's `clear()` is called.

   Delete and create entries register an `onEvict` that runs hard-delete + SAM3 cache drop. Move entries have no `onEvict`.

2. **Launch sweep.** On `Canvas` mount, fetch soft-deleted records older than 1 hour via `listTrashed({ olderThanMs: 3600_000 })` and hard-delete each one. This catches sessions where the user force-quit the app before eviction could fire, or left records soft-deleted across many launches.

The 1-hour threshold is a deliberate trade-off: long enough to catch a genuine "oops, I need that back" after reopening the app, short enough that a user doesn't accumulate many GB of invisible soft-deleted media across an active week. Configurable via a module-level constant in `canvasHistory.ts` if we revisit.

## PocketBase changes

### Migration

New migration file `pb/pb_migrations/<ts>_add_deleted_at.js`:

```js
migrate(
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(new Field({
        name: 'deleted_at',
        type: 'date',
      }));
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['images', 'videos']) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName('deleted_at');
      if (field) collection.fields.remove(field.id);
      app.save(collection);
    }
  },
);
```

`listRule` stays permissive (empty = public). Filtering happens in the client.

### `lib/pb.ts` API changes

- `PlacementRecordSchema` gains `deleted_at: z.string().optional().nullable()` (PB returns `""` or absent for unset date fields; schema tolerates both).
- `listImages` / `listVideos` — add `filter: 'deleted_at = null || deleted_at = ""'` to `getFullList` options.
- `deleteImage(id)` / `deleteVideo(id)` — change implementation to `pb.collection(…).update(id, { deleted_at: new Date().toISOString() })`. Signature returns `Promise<ImageRecord>` / `Promise<VideoRecord>` (the updated record) instead of `Promise<boolean>`. Callers in Canvas are updated accordingly.
- `restoreImage(id)` / `restoreVideo(id)` — new. `update(id, { deleted_at: null })`.
- `hardDeleteImage(id)` / `hardDeleteVideo(id)` — new. The original `pb.collection(…).delete(id)` call.
- `listTrashed({ olderThanMs })` — new. Returns `{ images: ImageRecord[]; videos: VideoRecord[] }` where each record has `deleted_at < (now - olderThanMs)`. Uses `filter: 'deleted_at != null && deleted_at != "" && deleted_at < "<iso>"'`.

## Keybindings

`lib/history/useHistoryShortcuts.ts`:

```ts
export function useHistoryShortcuts(history: HistoryController<unknown>): void;
```

Binds on `window` with `keydown`, capture phase, to match the existing Delete/Backspace handler style in Canvas:

- `(metaKey || ctrlKey) && !altKey && !shiftKey && key === 'z'` → `history.undo()`
- `(metaKey || ctrlKey) && !altKey && shiftKey && key === 'z'` → `history.redo()`
- `(metaKey || ctrlKey) && !altKey && !shiftKey && key === 'y'` → `history.redo()`

All three paths call `isTypingContext(e)` first and early-return if true, so typing Cmd-Z inside the highlight input or settings modal is ignored. `isTypingContext` is lifted verbatim from `Canvas.tsx` into `lib/dom/isTypingContext.ts`; Canvas is updated to import it.

## Data flow

```
pointerdown/drag/pointerup         deleteMediaById                  runUploadPlan resolved
         │                                │                                │
         ▼                                ▼                                ▼
  setMedia (optimistic)            soft-delete PB                   setMedia ← record
  updateX/Y PB (pointerup)         setMedia (local remove)          (already optimistic)
         │                                │                                │
         ▼                                ▼                                ▼
  history.push(moveEntry,…)   history.push(deleteEntry,…)   history.push(createEntry,…)
         │
         ▼
      past[]  ──(limit overflow)──▶ onEvict → hard-delete + sam3 cache drop
                                    onEvict fires on: overflow, future-clear, clear()

Cmd-Z ──▶ history.undo() ──▶ entry.undo() ──▶ inverse PB call + setMedia
Cmd-Shift-Z / Cmd-Y ──▶ history.redo() ──▶ entry.do() ──▶ forward PB call + setMedia

Canvas mount ──▶ listTrashed({ olderThanMs: 1h }) ──▶ hardDeleteX + sam3 cache drop
```

## Failure policy

- **Mutating PB call inside undo/redo fails.** Each action builder's `do`/`undo` closure follows the same pattern the existing handlers use: apply local state optimistically, then await the PB call; on rejection, restore the local state to what it was *before this invocation* (e.g., for move-undo: revert positions back from `from` to `to`; for delete-undo: remove the re-inserted items from `media` again; for create-undo: re-insert the removed items). `conn` flips to `offline`. The closure re-throws so the controller can see the failure. On a thrown `undo()` the controller rolls the entry back from `future` to `past`; on a thrown `do()` (during redo) the controller rolls it back from `past` to `future`. This way the next Cmd-Z (or Cmd-Shift-Z) retries the same operation.
- **`onEvict` fails.** Logged to `console.warn`, swallowed. The launch sweep is the catch-all.
- **Launch sweep fails.** Logged to `console.warn`, continues. Retries next launch.
- **`onError` option.** The `useHistory` hook accepts an `onError(err, phase)` callback for host-level observability. Canvas wires it to `console.warn` with a `[history]` prefix.

## Testing

`apps/app/src/lib/history/useHistory.test.ts` (vitest + `@testing-library/react`'s `renderHook`):

1. **Round-trip.** Push three entries, undo three times, redo three times. Verify each entry's `do`/`undo` is called exactly once per transition and in the right order.
2. **Limit eviction.** Create controller with `limit: 2`, push three entries, assert the first's `onEvict` ran and the remaining two are in `past`.
3. **Future clear.** Push three, undo twice (two now in `future`), push a new entry, assert both future entries' `onEvict` ran and `future` is empty.
4. **Clear().** Push two, call `clear()`, assert both `onEvict` ran and `canUndo`/`canRedo` are false.
5. **Async ordering.** `do`/`undo` return promises that resolve on a delay; verify a second `undo()` invoked before the first settles is serialized (queued, not interleaved).
6. **Error surfacing.** `undo` rejects; verify `onError(err, 'undo')` fires and the entry stays in `past` so retry is possible.
7. **`alreadyApplied`.** Push with `{ alreadyApplied: true }`; verify `do` is not called on push but is called on redo.

No integration test for the Canvas wiring in v1 — the existing canvas tests don't exercise PB, and building a PB harness for one test isn't worth it. The primitive's unit tests plus manual smoke coverage (drop → Cmd-Z → Cmd-Shift-Z; drag → Cmd-Z; delete → Cmd-Z → Cmd-Shift-Z; launch with soft-deleted row older than 1h) are sufficient.

## Risks and edge cases

- **Id stability across undo/redo** depends on PB preserving the record on soft-delete. Verified: `update()` never changes `id`, only mutates fields.
- **SAM3 cache keyed by id.** Staying intact on soft-delete is the desired behavior (instant post-undo segmentation). The Tauri command already handles missing cache gracefully by re-encoding.
- **Upload currently in-flight when user deletes via Delete key.** Unchanged — `deleteMediaById` still aborts the upload controller for pending items. Pending deletes do not produce history entries because there is no server-side state to undo.
- **Multi-window / multi-client.** Out of scope. NetraRT is a single-user desktop app; PB's realtime updates are not consumed by the app today.
- **Clock skew.** The sweep compares `deleted_at` (server-written on update) against client `Date.now()`. In practice both run on localhost, so skew is nil.
- **Canvas.tsx size.** Adding ~150 lines to a 2060-line file. Accepted for this sprint; all new logic lives in dedicated modules. A future refactor that splits Canvas into feature submodules is tracked separately.

## Out of scope (explicit)

- Undo for `bringToFront` / stack reorder.
- Undo for view (pan, zoom).
- Undo for selection, hover, marquee state.
- Undo for highlight-input text and SAM3 segmentation prompts/results.
- Undo for settings.
- Persisted history across app launches.
- A visible trash UI or manual "Empty Trash" control.
- Branching history, history inspection UI, per-action coalescing beyond "one drag = one entry."
