# Label Keyboard Navigation

Keyboard navigation and undoable deletion for the per-image tag list (`MediaTagList`) on the right side of the active image.

## Motivation

Today, clicking a pill in the tag list toggles it as the solo filter. There is no way to move between labels without reaching for the mouse, and the existing Delete key on a focused pill calls `removeSegmentTag` — which is **not** captured in the undo history. That's an asymmetry with every other mask/mask-set deletion in the canvas, all of which are undoable via `deleteMaskEntry`.

## Behavior

"Selected label" is the currently solo'd tag for the active image. There is at most one.

When a label is selected and the user is not in a typing context:

- **Arrow Down** — move solo to the next ready tag in the list
- **Arrow Up** — move solo to the previous ready tag in the list
- **Delete / Backspace** — delete all masks for the selected tag (undoable); solo clears

Arrows clamp at the ends (no wrap). Non-ready entries (`loading`, `error`) are skipped during navigation since only ready entries can be solo'd today. If the current solo tag isn't present in the active image's entries (stale), the handler treats the state as "nothing selected" and no-ops.

Existing behaviors preserved:

- Clicking a pill still toggles its solo state
- Clicking the same pill again still clears solo
- The pill's button-level `Delete`/`Backspace` keeps working, but now routes through the same undoable path (not the old `removeSegmentTag`)

## Where the keys are handled

A new window-level `keydown` `useEffect` in `Canvas.tsx`, mirroring the existing handlers for `deleteSelection` and `deleteMask`. Button-level handlers break when a re-render blurs the focused pill; window-level does not.

Gates, all required:

- `activeMedia?.kind === 'image'`
- `soloTag` is non-null
- `isTypingContext(e)` is false (reuse existing helper)
- No `metaKey` / `ctrlKey` modifiers (avoid shortcut collisions)
- For arrow keys, the key is exactly `ArrowUp` or `ArrowDown`
- For delete, the key is exactly `Delete` or `Backspace`

On match, `preventDefault()` and run the action.

## Undoable deletion via existing helper

`deleteMaskEntry({ imageId, tag, before, after: null, replaceTag: replaceReadyTag, onConn: setConn })` already does the right thing:

- `do()` removes the entry from UI state via `replaceReadyTag` and persists with `deleteSegmentationByImageTag`
- `undo()` restores the full `before` snapshot and re-upserts

The keyboard delete path and the pill-button delete path both construct `before` from the current ready entry for the tag, push the history entry, then clear `soloTag` (locally — undo will not restore solo state; see "Out of scope").

The old `onRemove` wiring on `MediaTagList` (currently `removeSegmentTag`) is replaced with a handler that runs the undoable path. `removeSegmentTag` itself is retained for any other callers (none today for `onRemove`); we can delete it in a follow-up if it becomes fully unused.

## Small pure helper for arrow nav

Extract the arrow-nav math into a unit-testable pure function:

```ts
// features/segmentation/tagNavigation.ts
import type { TagListEntry } from '../../components/MediaTagList';

export function nextSoloTag(
  current: string,
  entries: readonly TagListEntry[],
  dir: 'prev' | 'next',
): string | null;
```

Returns the new tag's original casing, or `null` when there is no movement (clamped at an end, or `current` not present). Case-insensitive match on `current`.

Tests in `features/segmentation/tagNavigation.test.ts` cover:

- Move to next / previous when mid-list
- Clamp at first / last (returns `null`)
- Skip non-ready entries in both directions
- Current tag absent from entries → `null`
- Empty list → `null`
- Case-insensitive match on `current`

## Files touched

- `apps/app/src/features/segmentation/tagNavigation.ts` (new)
- `apps/app/src/features/segmentation/tagNavigation.test.ts` (new)
- `apps/app/src/Canvas.tsx`:
  - Add `useEffect` for arrow/delete on `soloTag`
  - Add local handler (or inline in the `MediaTagList` `onRemove`) that builds the undoable delete entry and clears `soloTag`
  - Swap the current `onRemove={(tag) => removeSegmentTag(activeMedia.id, tag)}` to the undoable path
- `apps/app/src/components/MediaTagList.tsx`:
  - Update the `aria-label` hint (`"press Delete to remove"`) to reflect that Delete is now undoable — wording unchanged is acceptable; keep the button-level `onKeyDown` calling `onRemove` (semantics change via the new `onRemove` wiring upstream)

## Out of scope

- Left/Right arrow, Home/End
- Wrap-around navigation
- Multi-select across pills
- Keyboard nav when no label is selected (e.g., pressing Down to select the first tag)
- Restoring the prior `soloTag` on undo of a delete
- Deleting the `removeSegmentTag` helper (retained for now to minimize blast radius)

## Testing

- `tagNavigation.test.ts` — unit tests for the pure helper listed above
- Manual verification for the Canvas-level keyboard wiring (no existing Canvas integration test infra to extend in scope)
