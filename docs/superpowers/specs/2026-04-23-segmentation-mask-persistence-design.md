# Segmentation Mask Persistence — Design

**Date:** 2026-04-23
**Status:** Approved
**Scope:** Persist SAM3 segmentation results to PocketBase so they survive app reloads.

## Problem

Today, when a user segments an image in the canvas, the resulting masks live only in React state (`segments: Record<string, SegmentState>`). Reloading the app loses every segmentation. Tags (the prompts) already persist to localStorage, but the masks they produced do not.

Goal: when a user segments an image, the mask is written to PocketBase and rehydrates on the next session.

## Non-goals

- Persistence for videos. `submitSegment` early-returns on non-image media (`Canvas.tsx:1135`); videos don't have a segmentation flow today.
- Append-only segmentation history. The DB mirrors current UI state, not a log.
- Querying "all images tagged as X" from anywhere in the UI. The schema supports adding this later; no screen needs it now.
- Mask PNGs stored as PocketBase file uploads. Base64 inside a JSON field is simpler at current scale; this is swappable later without changing the row shape.
- Retry, upload queue, offline reconciliation. DB writes are fire-and-forget; the UI is the source of truth within a session.

## Data model

New PocketBase collection `segmentations`, one row per `(image, tag)` pair.

| Field | Type | Notes |
|---|---|---|
| `image` | `relation` → `images` | `cascadeDelete: true`, `maxSelect: 1`, `required: true` |
| `tag` | `text` (max 256) | Prompt text, case preserved (matches `TagSegment.tag`) |
| `masks` | `json` | Array of `{ png_base64, width, height, score, bbox }` — shape matches `SegMask[]` from `sam3_worker` |
| `source_width` | `number` | From `SegmentResponse.source_width` |
| `source_height` | `number` | From `SegmentResponse.source_height` |
| `created` | `autodate` onCreate | |
| `updated` | `autodate` onCreate + onUpdate | |

**Indexes:**
- `CREATE UNIQUE INDEX idx_seg_image_tag_lower ON segmentations (image, LOWER(tag))` — matches the case-insensitive de-dupe in `submitSegment` (`Canvas.tsx:1145`). Re-submitting `"Cat"` after `"cat"` updates the existing row.
- `CREATE INDEX idx_seg_image ON segmentations (image)` — hydration path.

**Access rules:** `listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule` all set to `""` (the same permissive config used by the `images` collection today).

**Cascade:** `cascadeDelete: true` on the relation means PocketBase hard-deletes segmentations when an image is hard-deleted. Soft-delete (setting `images.deleted_at`) leaves segmentation rows untouched — they come back on restore.

## Migration

`pb/pb_migrations/1777200000_init_segmentations.js` — mirrors `1776700800_init_images.js`:

- `up`: `new Collection({ type: 'base', name: 'segmentations', fields: [...], indexes: [...], ...Rule: '' })`, then `app.save(collection)`.
- `down`: `app.findCollectionByNameOrId('segmentations')` → `app.delete(collection)`.

## Client API — `apps/app/src/lib/pb.ts`

Zod schemas:

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

export type SegmentationRecord = z.infer<typeof SegmentationRecordSchema>;
```

Four new functions:

```ts
// Fetch every segmentation; caller groups by image.
export const listSegmentations = (): Promise<SegmentationRecord[]>;

// Case-insensitive upsert on (image, tag).
// Implementation: fetch the image's rows via
// pb.collection('segmentations').getFullList({ filter: `image="${id}"` }),
// find one whose tag.toLowerCase() === input.tag.toLowerCase(); if found,
// .update(existing.id, {...}), else .create({...}). The unique index on
// (image, LOWER(tag)) enforces the invariant at the DB layer. Per-image row
// counts stay small (one per tag), so a full-list read is cheap.
export const upsertSegmentation = (input: {
  image: string;
  tag: string;
  masks: SegMask[];
  source_width: number;
  source_height: number;
}): Promise<SegmentationRecord>;

// Delete any row for this image whose tag (lowercased) isn't in tagsToKeep
// (also lowercased). Fetches the list for the image, diffs in-memory, deletes
// the rest. Case-insensitive comparison matches the de-dupe rule.
export const deleteSegmentationsForImage = (
  imageId: string,
  tagsToKeep: string[],
): Promise<void>;

// Wipe all segmentations for an image. Called from clearSegment.
// (Image hard-delete also cascades via PB, but soft-delete doesn't, and this
// is the explicit "user cleared tags" path.)
export const deleteAllSegmentationsForImage = (imageId: string): Promise<void>;
```

No `createSegmentation` — all writes flow through `upsertSegmentation` to respect the uniqueness invariant.

## Canvas integration — `apps/app/src/Canvas.tsx`

### Persist on success

Inside `submitSegment` (`Canvas.tsx:1133`), in the `.then(response => ...)` handler at line 1190, after the existing `updateTag(tag, { tag, status: 'ready', response })`:

```ts
upsertSegmentation({
  image: m.id,
  tag,
  masks: response.masks,
  source_width: response.source_width,
  source_height: response.source_height,
}).catch((e) => console.warn('[sam3] persist failed', tag, e));
```

Only `status: 'ready'` persists. `loading` is transient; `error` is per-session.

### Delete removed tags on re-submit

In `submitSegment`, after building `cleaned` (around `Canvas.tsx:1149`) but before the setSegments call, fire-and-forget:

```ts
deleteSegmentationsForImage(m.id, cleaned).catch((e) =>
  console.warn('[sam3] prune failed', m.id, e),
);
```

This handles shrinking tag sets. The empty-list case (`cleaned.length === 0`) already routes through `clearSegment`.

### Hydrate on load

Wherever `listImages()` is called on canvas mount, also call `listSegmentations()` in parallel. Group rows by `image`, then seed initial `segments` state:

```ts
const grouped = new Map<string, SegmentationRecord[]>();
for (const r of segRows) {
  const arr = grouped.get(r.image) ?? [];
  arr.push(r);
  grouped.set(r.image, arr);
}
const initialSegments: Record<string, SegmentState> = {};
for (const [imageId, rows] of grouped) {
  initialSegments[imageId] = {
    entries: rows.map((r) => ({
      tag: r.tag,
      status: 'ready',
      response: {
        masks: r.masks,
        source_width: r.source_width,
        source_height: r.source_height,
      },
    })),
  };
}
setSegments(initialSegments);
```

Same path for web and Tauri — PB is authoritative.

### Clear path

`clearSegment` (`Canvas.tsx:1121`) currently only mutates local state. Add:

```ts
deleteAllSegmentationsForImage(id).catch((e) =>
  console.warn('[sam3] clear-persist failed', id, e),
);
```

## Race conditions and ordering

- `segmentSeqRef` (`Canvas.tsx:1124`) already guards the UI against stale resolutions. The persist call lives inside the same sequence-guarded `.then`; if the UI discards the response as stale, persistence never fires either.
- `deleteSegmentationsForImage` runs at the start of a submit and can race with in-flight writes from a previous submit. The unique `(image, lower(tag))` index prevents duplicate rows; the last write wins on `masks`. This is acceptable — the UI shows whatever resolved last anyway.
- No optimistic rollback. If a persist fails and the user reloads, the mask vanishes; they re-submit the tag. Logged to console.

## What to verify before calling this done

Manual:

1. Segment an image with `["cat", "dog"]`, reload the app — both masks re-render.
2. Segment with `["cat"]`, re-submit `["cat", "dog"]` — the `cat` row's `id` is unchanged (`updated` bumps), `dog` is a new row.
3. Segment with `["cat"]`, re-submit `["tree"]` — `cat` row deleted, `tree` row created.
4. Clear the tag input — all rows for that image are deleted from PB.
5. Hard-delete an image — rows cascade (query `segmentations` collection, count is 0 for that image).
6. Soft-delete an image, then restore — segmentations survive and re-render.
7. Submit `["Cat"]` after `["cat"]` — same row, updated in place.
8. Offline / PB down during a submit — UI still shows the mask; console warns; reload loses it (expected).

## File touch list

- `pb/pb_migrations/1777200000_init_segmentations.js` — new
- `apps/app/src/lib/pb.ts` — add schemas + 4 helpers
- `apps/app/src/Canvas.tsx` — 3 hooks: persist in `submitSegment` resolve, prune at submit start, wipe in `clearSegment`, hydrate on load

No changes to `sam3_worker.rs`, `lib.rs`, `savedTags.ts`, or the canvas rendering path — the mask data shape is unchanged end-to-end.
