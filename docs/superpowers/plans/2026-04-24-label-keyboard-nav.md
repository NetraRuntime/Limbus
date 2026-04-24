# Label Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Up/Down arrow navigation between tag pills in `MediaTagList` and make the Delete/Backspace path that removes all masks for a selected tag undoable.

**Architecture:** A pure helper (`nextSoloTag`) computes arrow navigation over a tag list. A new `useEffect` in `Canvas.tsx` listens at window level for `ArrowUp`/`ArrowDown`/`Delete`/`Backspace` while a solo tag is set on an image. Delete routes through the existing `deleteMaskEntry` history helper for undo. The `MediaTagList` `onRemove` prop is rewired to the same undoable path, so the per-pill Delete key matches window-level behavior.

**Tech Stack:** React + TypeScript (Vite), Vitest, existing `useHistory` + `deleteMaskEntry` helpers.

---

### Task 1: Add pure `nextSoloTag` helper with tests

**Files:**
- Create: `apps/app/src/features/segmentation/tagNavigation.ts`
- Create: `apps/app/src/features/segmentation/tagNavigation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/features/segmentation/tagNavigation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSoloTag } from './tagNavigation';
import type { TagListEntry } from '../../components/MediaTagList';

const ready = (tag: string): TagListEntry => ({ tag, status: 'ready' });
const loading = (tag: string): TagListEntry => ({ tag, status: 'loading' });
const error = (tag: string): TagListEntry => ({ tag, status: 'error' });

describe('nextSoloTag', () => {
  it('moves to the next ready tag', () => {
    const entries = [ready('cat'), ready('dog'), ready('bird')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('dog');
    expect(nextSoloTag('dog', entries, 'next')).toBe('bird');
  });

  it('moves to the previous ready tag', () => {
    const entries = [ready('cat'), ready('dog'), ready('bird')];
    expect(nextSoloTag('bird', entries, 'prev')).toBe('dog');
    expect(nextSoloTag('dog', entries, 'prev')).toBe('cat');
  });

  it('returns null when clamped at the last tag', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('dog', entries, 'next')).toBeNull();
  });

  it('returns null when clamped at the first tag', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('cat', entries, 'prev')).toBeNull();
  });

  it('skips non-ready entries when moving forward', () => {
    const entries = [ready('cat'), loading('dog'), error('bird'), ready('fish')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('fish');
  });

  it('skips non-ready entries when moving backward', () => {
    const entries = [ready('cat'), loading('dog'), error('bird'), ready('fish')];
    expect(nextSoloTag('fish', entries, 'prev')).toBe('cat');
  });

  it('returns null when the current tag is not in the list', () => {
    const entries = [ready('cat'), ready('dog')];
    expect(nextSoloTag('bird', entries, 'next')).toBeNull();
    expect(nextSoloTag('bird', entries, 'prev')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nextSoloTag('cat', [], 'next')).toBeNull();
    expect(nextSoloTag('cat', [], 'prev')).toBeNull();
  });

  it('matches current case-insensitively and returns the list entry casing', () => {
    const entries = [ready('Cat'), ready('Dog')];
    expect(nextSoloTag('cat', entries, 'next')).toBe('Dog');
    expect(nextSoloTag('DOG', entries, 'prev')).toBe('Cat');
  });

  it('returns null when the only ready tag is the current one', () => {
    const entries = [loading('cat'), ready('dog'), error('bird')];
    expect(nextSoloTag('dog', entries, 'next')).toBeNull();
    expect(nextSoloTag('dog', entries, 'prev')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- tagNavigation`
Expected: FAIL with "Failed to resolve import './tagNavigation'" or similar missing-module error.

- [ ] **Step 3: Implement `nextSoloTag`**

Create `apps/app/src/features/segmentation/tagNavigation.ts`:

```ts
import type { TagListEntry } from '../../components/MediaTagList';

/**
 * Compute the next solo tag when the user presses Arrow Up / Arrow Down in
 * the tag list. Skips non-ready entries (they can't be solo'd today).
 * Returns null when the move is clamped at an end, the current tag is not
 * present, or the list is empty.
 *
 * Matches `current` case-insensitively and returns the original casing from
 * `entries` so the caller can persist it as-is.
 */
export function nextSoloTag(
  current: string,
  entries: readonly TagListEntry[],
  dir: 'prev' | 'next',
): string | null {
  const key = current.toLowerCase();
  const readyIdxs: number[] = [];
  let currentReadyPos = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.status !== 'ready') continue;
    if (e.tag.toLowerCase() === key) currentReadyPos = readyIdxs.length;
    readyIdxs.push(i);
  }
  if (currentReadyPos === -1) return null;
  const targetPos = dir === 'next' ? currentReadyPos + 1 : currentReadyPos - 1;
  if (targetPos < 0 || targetPos >= readyIdxs.length) return null;
  return entries[readyIdxs[targetPos]].tag;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netrart/app test -- tagNavigation`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/tagNavigation.ts apps/app/src/features/segmentation/tagNavigation.test.ts
git commit -m "feat(segmentation): add nextSoloTag helper for tag arrow nav"
```

---

### Task 2: Re-export `nextSoloTag` from the segmentation barrel

**Files:**
- Modify: `apps/app/src/features/segmentation/index.ts`

- [ ] **Step 1: Add the export**

In `apps/app/src/features/segmentation/index.ts`, after the existing `deleteMaskEntry` export block, add:

```ts
export { nextSoloTag } from './tagNavigation';
```

Final file contents:

```ts
export type {
  MaskIdentity,
  ComposeInput,
  ComposedBake,
  BakeEntry,
} from './types';
export { SegmentBakeLayer } from './SegmentBakeLayer';
export { evictBake, evictDecode } from './bakeCache';
export {
  deleteMaskEntry,
  type DeleteMaskEntryArgs,
  type DeleteMaskMeta,
  type ReadyMaskEntry,
} from './deleteMaskEntry';
export { nextSoloTag } from './tagNavigation';
```

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/segmentation/index.ts
git commit -m "feat(segmentation): re-export nextSoloTag from barrel"
```

---

### Task 3: Add `deleteAllMasksForTag` undoable handler in Canvas

**Files:**
- Modify: `apps/app/src/Canvas.tsx` (insert after `deleteMask` definition, ending around line 1439)

This new callback wraps `deleteMaskEntry` with `after: null`, clears `soloTag` on `do`, and mirrors the pattern of `deleteMask`.

- [ ] **Step 1: Add the `deleteAllMasksForTag` callback**

Locate the existing `deleteMask` definition (currently `const deleteMask = useCallback(` near line 1389) and the closing `}, [segments, replaceReadyTag, history]);` near line 1439. Immediately after it, insert:

```tsx
  const deleteAllMasksForTag = useCallback(
    (imageId: string, tag: string) => {
      const current = segments[imageId];
      if (!current) return;
      const key = tag.toLowerCase();
      const ready = current.entries.find(
        (e): e is TagSegment & { status: 'ready' } =>
          e.status === 'ready' && e.tag.toLowerCase() === key,
      );
      if (!ready) return;

      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: {
          ...ready.response,
          masks: [...ready.response.masks],
        },
      };

      const entry = deleteMaskEntry({
        imageId,
        tag: ready.tag,
        before,
        after: null,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      setSoloTag((prev) =>
        prev && prev.toLowerCase() === key ? null : prev,
      );
      setSelectedMask((prev) =>
        prev && prev.imageId === imageId && prev.tag.toLowerCase() === key
          ? null
          : prev,
      );
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [segments, replaceReadyTag, history],
  );
```

Note: `setConn`, `setSelectedMask`, and `setSoloTag` are stable React setters; they do not need to be in the dependency list (none of the existing callbacks list them either — e.g., `deleteMask` above).

- [ ] **Step 2: Run type-check**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segmentation): add undoable deleteAllMasksForTag handler"
```

---

### Task 4: Route `MediaTagList` `onRemove` to the undoable handler

**Files:**
- Modify: `apps/app/src/Canvas.tsx` (the `MediaTagList` JSX around line 2593)

- [ ] **Step 1: Swap the `onRemove` wiring**

Locate the `MediaTagList` JSX block starting near line 2593. The current `onRemove` prop is:

```tsx
            onRemove={(tag) => removeSegmentTag(activeMedia.id, tag)}
```

Replace it with:

```tsx
            onRemove={(tag) => deleteAllMasksForTag(activeMedia.id, tag)}
```

Leave all other props on `MediaTagList` (including `onSelect`, `soloTag`, `onMouseEnter`, `onMouseLeave`, `entries`, `rect`) unchanged.

- [ ] **Step 2: Run type-check**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm --filter @netrart/app test`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "refactor(segmentation): route tag list onRemove through undoable delete"
```

---

### Task 5: Add window-level Arrow Up/Down handler for soloTag navigation

**Files:**
- Modify: `apps/app/src/Canvas.tsx` (insert new `useEffect` after the existing mask-delete `useEffect` ending around line 1833)

- [ ] **Step 1: Add the import for `nextSoloTag`**

Locate the existing import block from `./features/segmentation` (around lines 59–65):

```tsx
import {
  SegmentBakeLayer,
  evictBake,
  deleteMaskEntry,
  type MaskIdentity,
  type ReadyMaskEntry,
} from './features/segmentation';
```

Add `nextSoloTag` to the import list:

```tsx
import {
  SegmentBakeLayer,
  evictBake,
  deleteMaskEntry,
  nextSoloTag,
  type MaskIdentity,
  type ReadyMaskEntry,
} from './features/segmentation';
```

- [ ] **Step 2: Add the arrow-nav `useEffect`**

Locate the existing `useEffect` that handles mask delete (starting with `const onKey = (e: KeyboardEvent) => { if (e.key !== 'Delete' && e.key !== 'Backspace') return; if (!selectedMask) return;` near line 1814, ending with `[selectedMask, deleteMask]);` near line 1833).

Immediately after that effect's closing `}, [selectedMask, deleteMask]);`, insert:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingContext(e)) return;
      if (!activeMedia || activeMedia.kind !== 'image') return;
      if (!soloTag) return;
      const entries = segments[activeMedia.id]?.entries;
      if (!entries || entries.length === 0) return;
      const dir = e.key === 'ArrowDown' ? 'next' : 'prev';
      const next = nextSoloTag(
        soloTag,
        entries.map((en) => ({ tag: en.tag, status: en.status })),
        dir,
      );
      if (!next) return;
      e.preventDefault();
      setSoloTag(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMedia, soloTag, segments]);
```

- [ ] **Step 3: Run type-check**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segmentation): arrow up/down navigates the solo'd tag"
```

---

### Task 6: Add window-level Delete handler for solo'd tag

**Files:**
- Modify: `apps/app/src/Canvas.tsx` (insert new `useEffect` after the arrow-nav `useEffect` from Task 5)

The existing mask-delete `useEffect` (around line 1814) runs when `selectedMask` is set. We want a second Delete path that fires when `soloTag` is set but `selectedMask` is null — i.e., the user has solo'd a label and wants to wipe all of its masks.

- [ ] **Step 1: Add the delete-solo-tag `useEffect`**

Immediately after the arrow-nav `useEffect` you added in Task 5 (its closing `}, [activeMedia, soloTag, segments]);`), insert:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e)) return;
      if (!activeMedia || activeMedia.kind !== 'image') return;
      if (!soloTag) return;
      // Defer to the existing mask-delete handler when a specific mask is
      // selected — that path deletes one mask, not the whole tag.
      if (selectedMask) return;
      // The pill's own button-level onKeyDown already handles Delete when a
      // pill is focused. Skip here to avoid double-firing (and pushing two
      // history entries) as the native event bubbles to window.
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.media-tag-list')) return;
      e.preventDefault();
      deleteAllMasksForTag(activeMedia.id, soloTag);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMedia, soloTag, selectedMask, deleteAllMasksForTag]);
```

- [ ] **Step 2: Run type-check**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segmentation): delete key wipes all masks for solo'd tag (undoable)"
```

---

### Task 7: Manual verification & final test run

**Files:** (no edits)

- [ ] **Step 1: Run full test + typecheck + lint**

Run, in order:

```bash
pnpm --filter @netrart/app typecheck
pnpm --filter @netrart/app test
pnpm --filter @netrart/app lint
```

Expected: all PASS.

- [ ] **Step 2: Manual smoke test in dev**

Run: `pnpm --filter @netrart/app dev`

Open the app, drop an image, enter a few comma-separated tags to segment (e.g., `cat, dog, bird`). Wait for all to reach ready state. Then:

1. Click the `cat` pill — it should solo (others dim).
2. Press Arrow Down — `dog` becomes the solo tag; masks/bboxes update.
3. Press Arrow Down — `bird` becomes solo.
4. Press Arrow Down again — no change (clamped at end).
5. Press Arrow Up twice — back to `cat`.
6. Press Arrow Up — no change (clamped at start).
7. Press Delete — all `cat` masks disappear; the `cat` pill is gone; no pill is solo'd.
8. Press Cmd/Ctrl+Z — `cat` masks and pill return.
9. Click a mask in the image to select it, then press Delete — only that one mask disappears (existing `deleteMask` behavior, unaffected).
10. Click a pill to solo it, then focus a text input (e.g., the highlight input) and press Delete — nothing happens on the tag (typing-context gate).

Note any failures and reopen earlier tasks to fix.

- [ ] **Step 3: Final commit (if any fixups made)**

If the smoke test surfaced fixes, commit them with a descriptive message, e.g.:

```bash
git add <files>
git commit -m "fix(segmentation): <what you fixed from smoke test>"
```

Otherwise, no commit required for this task.

---

## Self-review notes

- **Spec coverage:**
  - Arrow Up/Down nav → Task 1 (helper) + Task 5 (wiring)
  - Delete on solo'd tag (undoable) → Task 3 (handler) + Task 6 (key wiring)
  - Pill-button Delete routes through same undoable path → Task 4
  - Non-ready entries skipped in nav → Task 1 (`nextSoloTag`)
  - Clamp at ends → Task 1
  - Solo clears after delete → Task 3 (`setSoloTag` in `deleteAllMasksForTag`)
  - Gates (typing context, modifiers, active image, solo set) → Tasks 5 & 6
- **Type/name consistency:** `deleteAllMasksForTag(imageId, tag)` is used identically in Tasks 3, 4, 6. `nextSoloTag(current, entries, dir)` matches in Tasks 1, 2, 5. `TagListEntry` is imported from `components/MediaTagList` where it's already exported.
- **No placeholders:** every step has concrete code, exact file paths, and exact commands.
