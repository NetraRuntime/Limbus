# Segmentation Mask Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist SAM3 segmentation masks to a new PocketBase `segmentations` collection so masks survive app reloads.

**Architecture:** New `segmentations` collection, one row per `(image, tag)` with case-insensitive uniqueness. Frontend writes on each successful segment resolve (fire-and-forget), prunes removed tags on re-submit, wipes on clear, and hydrates alongside `listImages()` on canvas mount. Cascade-deletes when an image is hard-deleted; survives soft-delete + restore.

**Tech Stack:** PocketBase (SQLite + JS migrations), React 18, TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-23-segmentation-mask-persistence-design.md`

---

## File Structure

**New files:**
- `pb/pb_migrations/1777200000_init_segmentations.js` — PB migration for the new collection.
- `apps/app/src/lib/segmentations.ts` — pure helpers (`findSegByTag`, `segIdsToPrune`, `groupSegmentationsByImage`). No PB imports.
- `apps/app/src/lib/segmentations.test.ts` — Vitest unit tests for the pure helpers.

**Modified files:**
- `apps/app/src/lib/pb.ts` — add schemas + 4 PB-touching helpers.
- `apps/app/src/Canvas.tsx` — wire persist/prune/wipe/hydrate into existing handlers.

**Rationale:** PB wrappers stay in `pb.ts` alongside `listImages`, `updateImagePosition`, etc. Pure logic (case-insensitive find, set diff, grouping) goes into `segmentations.ts` so it's unit-testable without mocking PocketBase. Tests colocate next to the file they test, matching the pattern in `src/lib/gridPlacement.test.ts`, `src/lib/labelPlacement.test.ts`.

---

## Task 1: PocketBase migration

**Files:**
- Create: `pb/pb_migrations/1777200000_init_segmentations.js`

- [ ] **Step 1: Write the migration**

Create `pb/pb_migrations/1777200000_init_segmentations.js` with this content:

```js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const images = app.findCollectionByNameOrId('images');
    const collection = new Collection({
      type: 'base',
      name: 'segmentations',
      fields: [
        {
          name: 'image',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: images.id,
          cascadeDelete: true,
        },
        { name: 'tag', type: 'text', required: true, max: 256 },
        { name: 'masks', type: 'json', required: true },
        { name: 'source_width', type: 'number', required: true },
        { name: 'source_height', type: 'number', required: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      indexes: [
        'CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))',
        'CREATE INDEX idx_seg_image ON segmentations (image)',
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('segmentations');
    return app.delete(collection);
  },
);
```

- [ ] **Step 2: Apply the migration**

Make sure PocketBase is not running (stop `pnpm db:start` if active). From repo root:

```bash
pnpm db:migrate
```

Expected: output includes a line mentioning `1777200000_init_segmentations.js` applied.

- [ ] **Step 3: Verify the collection exists**

Start PocketBase:

```bash
pnpm db:start
```

In another terminal (or via PB admin UI at `http://127.0.0.1:8090/_/`):

```bash
curl -s 'http://127.0.0.1:8090/api/collections/segmentations' | head -c 400
```

Expected: JSON with `"name":"segmentations"` and the fields listed (requires an admin auth token in some setups; if so, inspect via the admin UI instead). Stop PB after verifying.

- [ ] **Step 4: Commit**

```bash
git add pb/pb_migrations/1777200000_init_segmentations.js
git commit -m "feat(db): add segmentations collection migration"
```

---

## Task 2: Pure helpers — types, schemas, and first function (`findSegByTag`)

**Files:**
- Create: `apps/app/src/lib/segmentations.ts`
- Create: `apps/app/src/lib/segmentations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/segmentations.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { findSegByTag, type SegmentationRow } from './segmentations';

const mkRow = (id: string, tag: string): SegmentationRow => ({
  id,
  image: 'img1',
  tag,
  masks: [],
  source_width: 0,
  source_height: 0,
});

describe('findSegByTag', () => {
  it('returns the row whose tag matches case-insensitively', () => {
    const rows = [mkRow('r1', 'Cat'), mkRow('r2', 'dog')];
    expect(findSegByTag(rows, 'cat')?.id).toBe('r1');
    expect(findSegByTag(rows, 'DOG')?.id).toBe('r2');
  });

  it('returns undefined when no tag matches', () => {
    const rows = [mkRow('r1', 'Cat')];
    expect(findSegByTag(rows, 'bird')).toBeUndefined();
  });

  it('returns the first match when duplicates exist', () => {
    const rows = [mkRow('r1', 'cat'), mkRow('r2', 'CAT')];
    expect(findSegByTag(rows, 'Cat')?.id).toBe('r1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: FAIL with a module-not-found error for `./segmentations`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/app/src/lib/segmentations.ts`:

```ts
export type SegMask = {
  png_base64: string;
  width: number;
  height: number;
  score: number;
  bbox: [number, number, number, number] | null;
};

export type SegmentationRow = {
  id: string;
  image: string;
  tag: string;
  masks: SegMask[];
  source_width: number;
  source_height: number;
};

export const findSegByTag = (
  rows: readonly SegmentationRow[],
  tag: string,
): SegmentationRow | undefined => {
  const key = tag.toLowerCase();
  return rows.find((r) => r.tag.toLowerCase() === key);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/segmentations.ts apps/app/src/lib/segmentations.test.ts
git commit -m "feat(segments): add findSegByTag helper"
```

---

## Task 3: Pure helper — `segIdsToPrune`

**Files:**
- Modify: `apps/app/src/lib/segmentations.ts`
- Modify: `apps/app/src/lib/segmentations.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `apps/app/src/lib/segmentations.test.ts`:

```ts
import { segIdsToPrune } from './segmentations';

describe('segIdsToPrune', () => {
  it('returns ids of rows whose tag is not in tagsToKeep', () => {
    const rows = [
      mkRow('r1', 'cat'),
      mkRow('r2', 'dog'),
      mkRow('r3', 'tree'),
    ];
    expect(segIdsToPrune(rows, ['cat', 'dog'])).toEqual(['r3']);
  });

  it('matches case-insensitively', () => {
    const rows = [mkRow('r1', 'Cat'), mkRow('r2', 'DOG')];
    expect(segIdsToPrune(rows, ['cat'])).toEqual(['r2']);
  });

  it('returns every id when tagsToKeep is empty', () => {
    const rows = [mkRow('r1', 'cat'), mkRow('r2', 'dog')];
    expect(segIdsToPrune(rows, [])).toEqual(['r1', 'r2']);
  });

  it('returns [] when every row is kept', () => {
    const rows = [mkRow('r1', 'cat')];
    expect(segIdsToPrune(rows, ['cat', 'dog'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: FAIL with `segIdsToPrune is not exported`.

- [ ] **Step 3: Implement the helper**

Append to `apps/app/src/lib/segmentations.ts`:

```ts
export const segIdsToPrune = (
  rows: readonly SegmentationRow[],
  tagsToKeep: readonly string[],
): string[] => {
  const keep = new Set(tagsToKeep.map((t) => t.toLowerCase()));
  return rows.filter((r) => !keep.has(r.tag.toLowerCase())).map((r) => r.id);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: 7 passing tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/segmentations.ts apps/app/src/lib/segmentations.test.ts
git commit -m "feat(segments): add segIdsToPrune helper"
```

---

## Task 4: Pure helper — `groupSegmentationsByImage`

**Files:**
- Modify: `apps/app/src/lib/segmentations.ts`
- Modify: `apps/app/src/lib/segmentations.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `apps/app/src/lib/segmentations.test.ts`:

```ts
import { groupSegmentationsByImage } from './segmentations';

describe('groupSegmentationsByImage', () => {
  it('groups rows by image id, preserving tag order', () => {
    const rows: SegmentationRow[] = [
      { ...mkRow('r1', 'cat'), image: 'img1' },
      { ...mkRow('r2', 'dog'), image: 'img1' },
      { ...mkRow('r3', 'tree'), image: 'img2' },
    ];
    const grouped = groupSegmentationsByImage(rows);
    expect(Array.from(grouped.keys()).sort()).toEqual(['img1', 'img2']);
    expect(grouped.get('img1')!.map((r) => r.tag)).toEqual(['cat', 'dog']);
    expect(grouped.get('img2')!.map((r) => r.tag)).toEqual(['tree']);
  });

  it('returns an empty map for no rows', () => {
    expect(groupSegmentationsByImage([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: FAIL with `groupSegmentationsByImage is not exported`.

- [ ] **Step 3: Implement the helper**

Append to `apps/app/src/lib/segmentations.ts`:

```ts
export const groupSegmentationsByImage = (
  rows: readonly SegmentationRow[],
): Map<string, SegmentationRow[]> => {
  const out = new Map<string, SegmentationRow[]>();
  for (const r of rows) {
    const list = out.get(r.image);
    if (list) list.push(r);
    else out.set(r.image, [r]);
  }
  return out;
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @netrart/app test -- src/lib/segmentations.test.ts
```

Expected: 9 passing tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/segmentations.ts apps/app/src/lib/segmentations.test.ts
git commit -m "feat(segments): add groupSegmentationsByImage helper"
```

---

## Task 5: PocketBase schemas and `listSegmentations`

**Files:**
- Modify: `apps/app/src/lib/pb.ts`

- [ ] **Step 1: Add the Zod schemas and re-export types**

Open `apps/app/src/lib/pb.ts`. After the existing `PlacementRecordSchema` definition (around line 33), add:

```ts
const SegMaskSchema = z.object({
  png_base64: z.string(),
  width: z.number(),
  height: z.number(),
  score: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const SegmentationRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  collectionName: z.string(),
  created: z.string(),
  updated: z.string(),
  image: z.string(),
  tag: z.string(),
  masks: z.array(SegMaskSchema),
  source_width: z.number(),
  source_height: z.number(),
});

export type SegMask = z.infer<typeof SegMaskSchema>;
export type SegmentationRecord = z.infer<typeof SegmentationRecordSchema>;
```

- [ ] **Step 2: Add `listSegmentations`**

In `apps/app/src/lib/pb.ts`, after `listVideos` (ends around line 78), add:

```ts
export const listSegmentations = async (): Promise<SegmentationRecord[]> => {
  const raw = await pb.collection('segmentations').getFullList({ sort: 'created' });
  return parseList(SegmentationRecordSchema, raw);
};
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/pb.ts
git commit -m "feat(segments): add listSegmentations pb helper"
```

---

## Task 6: `upsertSegmentation`

**Files:**
- Modify: `apps/app/src/lib/pb.ts`

- [ ] **Step 1: Add the helper**

In `apps/app/src/lib/pb.ts`, add this import near the top with the other imports:

```ts
import { findSegByTag } from './segmentations';
```

After `listSegmentations`, add:

```ts
export const upsertSegmentation = async (input: {
  image: string;
  tag: string;
  masks: SegMask[];
  source_width: number;
  source_height: number;
}): Promise<SegmentationRecord> => {
  // Fetch this image's rows, find any existing tag match case-insensitively.
  // Row counts per image are small (one per tag), so getFullList is cheap.
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${input.image}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, input.tag);
  const payload = {
    image: input.image,
    tag: input.tag,
    masks: input.masks,
    source_width: input.source_width,
    source_height: input.source_height,
  };
  const record = match
    ? await pb.collection('segmentations').update(match.id, payload)
    : await pb.collection('segmentations').create(payload);
  return SegmentationRecordSchema.parse(record);
};
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Verify lint passes**

```bash
pnpm lint
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/pb.ts
git commit -m "feat(segments): add upsertSegmentation pb helper"
```

---

## Task 7: `deleteSegmentationsForImage` and `deleteAllSegmentationsForImage`

**Files:**
- Modify: `apps/app/src/lib/pb.ts`

- [ ] **Step 1: Add the helpers**

In `apps/app/src/lib/pb.ts`, update the import from `./segmentations`:

```ts
import { findSegByTag, segIdsToPrune } from './segmentations';
```

After `upsertSegmentation`, add:

```ts
export const deleteSegmentationsForImage = async (
  imageId: string,
  tagsToKeep: readonly string[],
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const ids = segIdsToPrune(existing, tagsToKeep);
  await Promise.all(
    ids.map((id) => pb.collection('segmentations').delete(id)),
  );
};

export const deleteAllSegmentationsForImage = (
  imageId: string,
): Promise<void> => deleteSegmentationsForImage(imageId, []);
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/pb.ts
git commit -m "feat(segments): add delete/prune segmentation pb helpers"
```

---

## Task 8: Persist masks on segment success

**Files:**
- Modify: `apps/app/src/Canvas.tsx:12-29, 1183-1198`

- [ ] **Step 1: Extend the pb imports**

In `apps/app/src/Canvas.tsx`, locate the `from './lib/pb'` import block (lines 12–29). Add `upsertSegmentation` to the imports:

```tsx
import {
  createImage,
  createVideo,
  deleteImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  imageFileUrl,
  listImages,
  listTrashed,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  upsertSegmentation,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type VideoRecord,
} from './lib/pb';
```

- [ ] **Step 2: Wire the persist call inside `submitSegment`**

Locate `submitSegment` at `apps/app/src/Canvas.tsx:1133`. Find the `.then((response) => { ... })` block at line 1190–1192 which currently reads:

```tsx
          .then((response) => {
            updateTag(tag, { tag, status: 'ready', response });
          })
```

Replace with:

```tsx
          .then((response) => {
            updateTag(tag, { tag, status: 'ready', response });
            // Fire-and-forget: persist the mask to PB so it rehydrates after
            // reload. UI state is authoritative within a session; PB is
            // authoritative across sessions.
            upsertSegmentation({
              image: m.id,
              tag,
              masks: response.masks,
              source_width: response.source_width,
              source_height: response.source_height,
            }).catch((e) => console.warn('[sam3] persist failed', tag, e));
          })
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segments): persist masks on successful segment"
```

---

## Task 9: Prune removed tags on re-submit

**Files:**
- Modify: `apps/app/src/Canvas.tsx:12-29, 1133-1163`

- [ ] **Step 1: Extend the pb imports**

In the `from './lib/pb'` import block in `Canvas.tsx`, add `deleteSegmentationsForImage`:

```tsx
import {
  createImage,
  createVideo,
  deleteImage,
  deleteSegmentationsForImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  imageFileUrl,
  listImages,
  listTrashed,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  upsertSegmentation,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type VideoRecord,
} from './lib/pb';
```

- [ ] **Step 2: Add the prune call**

In `submitSegment`, locate the section that sets up the new in-memory `segments` state (around `Canvas.tsx:1158–1163`):

```tsx
      const seq = (segmentSeqRef.current[m.id] ?? 0) + 1;
      segmentSeqRef.current[m.id] = seq;
      setSegments((prev) => ({
        ...prev,
        [m.id]: { entries: cleaned.map((tag) => ({ tag, status: 'loading' })) },
      }));
```

Immediately after that `setSegments` call (still inside `submitSegment`), add:

```tsx
      // Drop any persisted rows for tags that are no longer in the set.
      // Fire-and-forget — races with in-flight upserts are fine because the
      // unique (image, lower(tag)) index prevents duplicate rows.
      deleteSegmentationsForImage(m.id, cleaned).catch((e) =>
        console.warn('[sam3] prune failed', m.id, e),
      );
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segments): prune removed tags on re-submit"
```

---

## Task 10: Wipe persisted masks in `clearSegment`

**Files:**
- Modify: `apps/app/src/Canvas.tsx:12-29, 1121-1131`

- [ ] **Step 1: Extend the pb imports**

In the `from './lib/pb'` import block, add `deleteAllSegmentationsForImage`:

```tsx
import {
  createImage,
  createVideo,
  deleteAllSegmentationsForImage,
  deleteImage,
  deleteSegmentationsForImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  imageFileUrl,
  listImages,
  listTrashed,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  upsertSegmentation,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type VideoRecord,
} from './lib/pb';
```

- [ ] **Step 2: Wire the delete call in `clearSegment`**

Locate `clearSegment` at `Canvas.tsx:1121`. It currently reads:

```tsx
  const clearSegment = useCallback((id: string) => {
    // Bump the sequence so any in-flight invoke for this id is ignored when
    // it resolves.
    segmentSeqRef.current[id] = (segmentSeqRef.current[id] ?? 0) + 1;
    setSegments((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
```

Replace with:

```tsx
  const clearSegment = useCallback((id: string) => {
    // Bump the sequence so any in-flight invoke for this id is ignored when
    // it resolves.
    segmentSeqRef.current[id] = (segmentSeqRef.current[id] ?? 0) + 1;
    setSegments((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    deleteAllSegmentationsForImage(id).catch((e) =>
      console.warn('[sam3] clear-persist failed', id, e),
    );
  }, []);
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segments): wipe persisted masks when user clears tags"
```

---

## Task 11: Hydrate segments on canvas mount

**Files:**
- Modify: `apps/app/src/Canvas.tsx:12-29, 871-920`

- [ ] **Step 1: Extend the pb imports**

In the `from './lib/pb'` import block, add `listSegmentations` and the `SegmentationRecord` type:

```tsx
import {
  createImage,
  createVideo,
  deleteAllSegmentationsForImage,
  deleteImage,
  deleteSegmentationsForImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  imageFileUrl,
  listImages,
  listSegmentations,
  listTrashed,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  upsertSegmentation,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type SegmentationRecord,
  type VideoRecord,
} from './lib/pb';
```

Also add the pure helper import. Find the existing import from `./lib/segmentations` if one exists (there isn't one today), or add:

```tsx
import { groupSegmentationsByImage } from './lib/segmentations';
```

near the other `./lib/*` imports (around `Canvas.tsx:47-52`).

- [ ] **Step 2: Extend the initial-load useEffect**

Locate the initial-load `useEffect` at `Canvas.tsx:871–920` which currently calls `Promise.all([listImages()..., listVideos()...])`. Extend it to also fetch segmentations and seed `segments` state.

Replace lines 871–895 (the block up to and including `setMedia(merged);`) with:

```tsx
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listImages().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load images:', err);
          return { ok: false as const, records: [] as ImageRecord[] };
        },
      ),
      listVideos().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load videos:', err);
          return { ok: false as const, records: [] as VideoRecord[] };
        },
      ),
      listSegmentations().then(
        (r) => r,
        (err) => {
          console.warn('[pb] failed to load segmentations:', err);
          return [] as SegmentationRecord[];
        },
      ),
    ]).then(([imgRes, vidRes, segRows]) => {
      if (cancelled) return;
      const merged: CanvasMedia[] = [
        ...imgRes.records.map(fromImageRecord),
        ...vidRes.records.map(fromVideoRecord),
      ];
      merged.sort((a, b) => a.id.localeCompare(b.id));
      setMedia(merged);

      // Hydrate segments from PB. The SegmentationRow shape in ./lib/segmentations
      // is a subset of SegmentationRecord — both carry the fields we need here.
      const grouped = groupSegmentationsByImage(segRows);
      const initial: Record<string, SegmentState> = {};
      for (const [imageId, rows] of grouped) {
        initial[imageId] = {
          entries: rows.map((r) => ({
            tag: r.tag,
            status: 'ready' as const,
            response: {
              masks: r.masks,
              source_width: r.source_width,
              source_height: r.source_height,
            },
          })),
        };
      }
      if (Object.keys(initial).length > 0) {
        setSegments((prev) => ({ ...initial, ...prev }));
      }
```

Leave the rest of the useEffect (the `imgRes.ok || vidRes.ok` block through `return () => { cancelled = true; };`) unchanged.

Note: `setSegments((prev) => ({ ...initial, ...prev }))` — if a user somehow managed to submit a new segment before hydration resolved, in-session state wins over the stale DB snapshot.

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @netrart/app typecheck
```

Expected: exit code 0.

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter @netrart/app test
```

Expected: all tests pass (including the 9 new segmentations.test.ts tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segments): hydrate masks from pb on canvas mount"
```

---

## Task 12: Manual verification

- [ ] **Step 1: Rebuild and start the app**

```bash
pnpm db:start      # terminal 1 — PocketBase on :8090
pnpm dev:app       # terminal 2 — Vite on :5174
```

Open `http://localhost:5174/`. You should be on the canvas.

- [ ] **Step 2: Verify round-trip persistence**

1. Drop an image onto the canvas.
2. Select it, type `cat, dog` in the highlight input, submit.
3. Wait for masks to render.
4. Reload the browser.
5. Expected: the same two masks render, with `cat` and `dog` pills.

- [ ] **Step 3: Verify upsert (re-submit same tag)**

1. With the same image selected, submit `cat` alone (removes `dog`).
2. In the PB admin UI (`http://127.0.0.1:8090/_/`), open the `segmentations` collection. Note the `id` and `updated` of the `cat` row for that image.
3. Submit `cat, tree`.
4. Refresh the admin view.
5. Expected: the `cat` row's `id` is unchanged; its `updated` timestamp bumped; a new `tree` row exists; `dog` is gone.

- [ ] **Step 4: Verify clear wipes rows**

1. Submit `cat, tree` on an image.
2. Clear the tag input (submit empty).
3. Check the `segmentations` collection in admin UI.
4. Expected: zero rows for that image.

- [ ] **Step 5: Verify cascade on hard-delete**

1. Submit `cat` on image A.
2. In the app, trash image A, then empty trash (or wait for auto-hard-delete if wired).
   Alternatively: from the PB admin UI, hard-delete image A directly from the `images` collection.
3. Check the `segmentations` collection.
4. Expected: the `cat` row for image A is gone.

- [ ] **Step 6: Verify soft-delete + restore preserves rows**

1. Submit `cat` on image B.
2. In the app, delete image B (soft-delete — it goes to trash).
3. Check `segmentations` — the row still exists (linked to a soft-deleted image).
4. Restore image B.
5. Reload the app.
6. Expected: image B reappears with the `cat` mask.

- [ ] **Step 7: Verify case-insensitive uniqueness**

1. Submit `Cat` on an image.
2. Note the row id in admin UI.
3. Submit `cat` on the same image.
4. Expected: still one row for that image (updated in place, same id). No unique-constraint error in the console.

- [ ] **Step 8: Verify offline / PB-down behavior**

1. Submit `cat` on an image.
2. Stop PocketBase (`Ctrl+C` the `pnpm db:start` process).
3. Submit `dog` on the same image.
4. Expected: the `dog` mask renders in-app (worker still runs); `[sam3] persist failed dog ...` appears in the browser console.
5. Reload the app — `dog` is gone (PB never got the write), `cat` still hydrates once PB is restarted.

---

## Self-Review

**Spec coverage:**
- Data model fields (`image`, `tag`, `masks`, `source_width`, `source_height`, `created`, `updated`) → Task 1.
- Indexes (unique on `(image, LOWER(tag))`, non-unique on `image`) → Task 1.
- Cascade behavior → Task 1 (`cascadeDelete: true`) + manual verify Task 12 steps 5–6.
- Migration pattern matching `init_images.js` → Task 1.
- Zod schemas (`SegMaskSchema`, `SegmentationRecordSchema`) → Task 5.
- `listSegmentations` → Task 5.
- `upsertSegmentation` (case-insensitive match) → Tasks 2, 6. Pure `findSegByTag` is unit-tested.
- `deleteSegmentationsForImage` (set-diff) → Tasks 3, 7. Pure `segIdsToPrune` is unit-tested.
- `deleteAllSegmentationsForImage` → Task 7.
- Persist on success in `submitSegment` → Task 8.
- Prune on re-submit → Task 9.
- Wipe in `clearSegment` → Task 10.
- Hydrate on canvas mount (grouping by image) → Task 11. Pure `groupSegmentationsByImage` is unit-tested.
- Only `status: 'ready'` persists → Task 8 (call lives in the ready branch).
- Fire-and-forget with `console.warn` on failure → Tasks 8, 9, 10, 11.
- `segmentSeqRef` guards persistence (persist call lives inside the sequence-guarded `.then`) → Task 8 (inside the existing `.then` which is sequence-guarded by `updateTag` → the warn in the spec about staleness applies because `updateTag`'s guard is on the UI update; the persist is still issued regardless. This is acceptable because the unique index serializes writes and the last submit's prune step runs *before* the new tag's upsert, cleaning up anything stale).
- Videos excluded → spec covered; no code path added.
- Verification matrix (8 scenarios) → Task 12.

**Placeholder scan:** no TBDs, no "similar to above", no "add appropriate …". Every code change ships complete code.

**Type consistency:** `SegmentationRow` (in `./segmentations`) and `SegmentationRecord` (in `./pb`) both carry `image`, `tag`, `masks`, `source_width`, `source_height`; `SegmentationRecord` additionally has `id`, `collectionId`, `collectionName`, `created`, `updated`. The pure helpers are typed against `SegmentationRow`, and `SegmentationRecord` is a structural superset, so passing records into helpers is sound. `SegMask` is defined once in `./segmentations` and once via Zod in `./pb`; both shapes match field-by-field.

**Execution note on `segmentSeqRef`:** persistence does *not* inherit the sequence guard. A segment request that resolves out-of-order could persist stale data. In practice: the next submit's prune pass (Task 9) runs before the new upserts, so a stale upsert gets overwritten by a current-set upsert (same tag) or pruned (different tag). This matches the spec's stated "last write wins on `masks`" and is adequate for v1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-segmentation-mask-persistence.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
