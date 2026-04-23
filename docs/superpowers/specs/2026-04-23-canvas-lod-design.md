# Canvas Level-of-Detail (LoD) System

**Date:** 2026-04-23
**Scope:** `apps/app` — infinite-canvas rendering path for images and videos
**Status:** Design approved, awaiting implementation plan

## Problem

`Canvas.tsx` renders each media record as a full-resolution `<img>` or
autoplaying `<video>` element, regardless of how much screen space it
occupies. Two failure modes result:

1. **Zoomed out:** dozens of full-res textures and live video decodes
   paint into a few pixels each. GPU memory and decode pressure grow
   unbounded; performance collapses on moderately-sized projects.
2. **Zoomed in:** a 400 px source image dragged to cover 4000 px of
   viewport relies on bilinear browser scaling. We accept this — the
   user chose a zoom level beyond native resolution — but it shapes
   what the LoD system does *not* try to do.

LoD generates a pyramid of downscaled thumbnails per asset, picks the
smallest one that still looks right on screen, and keeps real `<video>`
elements alive only while they occupy enough space to matter.

## Goals

- **Shrink zoom-out cost.** Replace tiny-on-screen full-res images with
  cached thumbnails and pause video playback (swap to a poster `<img>`).
- **Preserve zoom-in clarity.** At any zoom where the full-res source
  is the best available, render it directly. Mips never downgrade a
  crisp view.
- **No user intervention.** Generation happens in the background; the
  user never sees a spinner dedicated to "building thumbnails".
- **Client-only.** No PocketBase schema change, no server load; works
  offline, works with the existing DB.

## Non-goals

- Super-resolution or perceptual upscaling above 1:1. Browser default
  bilinear is fine at higher zooms.
- Per-frame video thumbnails (scrubbable mip). One poster per video.
- Coordinated multi-tab writes. IndexedDB is origin-scoped so tabs
  share the same store; concurrent writes to the same key are safe
  (same assetId + levelPx produces identical bytes), but no
  leader-election or cross-tab cache coordination is attempted.
- Configurable cache budget surfaced in Settings UI. Ships with a
  fixed 512 MB default; tunable later.

## Architecture

New feature folder under `apps/app/src/features/lod/` (per the
repo's feature-folder convention in `CLAUDE.md`):

```
features/lod/
  api/
    lodCache.ts          # IDB wrapper: get/put/touch/evict, stratified LRU
  hooks/
    useLodSources.ts     # Canvas-level: map<id, { lodSrc, playVideo }> for visible items
    useLodHydration.ts   # Background queue, on-first-sight generation
  worker/
    mip.worker.ts        # OffscreenCanvas pyramid generation (single worker instance)
  util/
    mipLevels.ts         # Pure: pyramid sizes from source dims
    pickLevel.ts         # Pure: select smallest level ≥ on-screen × DPR, with hysteresis
    posterFrame.ts       # Extract t=0 frame from a video URL
  types.ts               # MipLevel, CacheKey, AssetKind, LodEntry, LodSource
  index.ts               # Public API barrel
```

### Integration into `Canvas.tsx`

- One new hook call after `paintMedia` is computed:
  `const lod = useLodSources(paintMedia, view.scale, devicePixelRatio)`.
- `MediaItem` gains two props:
  - `lodSrc?: string` — blob URL for the chosen mip level (undefined
    falls back to `m.src`).
  - `playVideo: boolean` — for videos, decides `<video>` (true) vs
    `<img src={lodSrc}>` (false).
- On upload, `useLodHydration` is notified via a priority enqueue so
  the just-dropped file hydrates before the background backlog.
- On `deleteImage` / `deleteVideo`, the feature listens on a shared
  `onDelete(id)` callback to purge cache entries.

### New dependency

- `idb` (~1 kB gzipped) — type-safe promise wrapper around IndexedDB.
  Avoids hand-rolling transaction boilerplate.

## Mip pyramid

Constants:

```
MIN_LEVEL_PX = 64     // baseline; always cached, never evicted
MAX_LEVEL_PX = 1024   // above this, full-res is used directly
```

Per-asset levels are computed once from the source's longest side:

```
pyramid = [1024, 512, 256, 128, 64]
         .filter(px => px <= longestSide)
         .filter(px => px >= MIN_LEVEL_PX)
```

Each level stores the scaled image as a WebP `Blob` (quality 0.8),
aspect ratio preserved, with the scaled longest-side equal to `levelPx`.

A 300 × 400 source produces `[256, 128, 64]`. A 4000 × 3000 source
produces `[1024, 512, 256, 128, 64]`. `MIN_LEVEL_PX` is always in the
set (provided the source is at least that large — tiny sources are
not thumbnailed).

### Level picker

```ts
pickLevel(levels, onScreenPx, dpr, currentLevel?):
  target = onScreenPx * dpr
  candidate = smallest level where level.px >= target
  if candidate is undefined: return 'full'
  // Hysteresis: avoid rapid A/B swap mid-zoom.
  if currentLevel and candidate.px > currentLevel.px:
    if onScreenPx * dpr < currentLevel.px * 1.25: return currentLevel
  return candidate
```

Downgrades (smaller target) apply immediately. Upgrades only fire once
the target exceeds the current level by 25 %.

### Video posters

`posterFrame(src)` creates a detached `<video>` element, sets
`preload='metadata'`, `muted=true`, seeks to `t=0`, waits for
`seeked`, then draws to an OffscreenCanvas and returns an
`ImageBitmap`. That bitmap feeds the same pyramid generator as
images — videos share the image code path end-to-end.

For videos, `playVideo` threshold is `MAX_LEVEL_PX` (1024 px
on-screen): below, `<img>` with the poster mip; above, the live
`<video>`.

## Cache

IndexedDB database `netra-lod`, version 1:

**Object store `lod`:**
```
key:   `${assetId}|${levelPx}`
value: {
  assetId: string,
  levelPx: number,
  kind: 'image' | 'video',
  blob: Blob,
  bytes: number,
  lastAccessed: number,  // ms epoch
}
```

**Object store `meta`:** single record `{ totalBytes: number }` for
budget tracking (single-writer, updated in the same transaction as
`put`/`delete`).

**Stratified LRU eviction:**

- On `put`: write the entry, increment `totalBytes`. If
  `totalBytes > BUDGET` (default 512 MB), run `evict()`.
- `evict()` loads all entries with `levelPx > MIN_LEVEL_PX`, sorts by
  `lastAccessed` ascending, deletes until `totalBytes ≤ BUDGET * 0.9`
  (hysteresis margin so we don't thrash on the boundary).
- Baseline entries (`levelPx === MIN_LEVEL_PX`) are never evicted.
  They're cheap (~2–8 KB each at 64 px WebP) and guarantee every asset
  has *something* to render while zoomed out.
- On `get`: lazily touch `lastAccessed` via a microtask; never on the
  hot read path.

**Blob URL lifecycle:**

`useLodSources` maintains a ref-counted `Map<assetId, Map<levelPx,
{ url: string; refs: number }>>`. A URL is created on first reference
and revoked when:

- The asset is no longer in the visible set for > 1 s, AND
- No component holds an active reference.

On unmount, all tracked URLs are revoked. On cache eviction, the
corresponding entry is marked for revocation after the last reader
drops it.

## Generation pipeline

### Worker

Single shared `Worker` instance at `features/lod/worker/mip.worker.ts`.
Messages (structured clone, transferable blobs):

```
// main → worker
{ type: 'generate', id, assetId, kind, source, sourceDims }
  source:
    - image: { kind: 'url', url } or { kind: 'file', file: File }
    - video: { kind: 'url', url } (worker handles poster extraction)
{ type: 'cancel', id }

// worker → main
{ type: 'level', id, assetId, levelPx, blob, bytes }
{ type: 'done', id, assetId }
{ type: 'error', id, assetId, message }
```

Concurrency: the worker processes one `generate` at a time. WebP
encoding is fast; parallelism adds contention, not speed. Work is
queued in the worker.

### Orchestrator (`useLodHydration`)

Owns the queue on the main thread. Two states:

- `hydrated: Set<string>` — baseline level exists in cache.
- `pending: Set<string>` — generation in flight.

Per media change:
- Diff `media` against `hydrated ∪ pending`. For each new id, check
  the cache for its baseline. If present → add to `hydrated`. If not →
  enqueue.

Queue processing:
- One concurrent worker job. Next item picked when the worker emits
  `done` or `error`.
- On each level received, `lodCache.put` writes it and the main
  thread notifies `useLodSources` so any in-flight view updates pick
  up the new blob on the next frame.
- Background enqueues wrapped in `requestIdleCallback` (fallback
  `setTimeout(0)`) so hydration yields to interaction.
- Upload enqueues bypass idle — user just dropped the file, they
  expect the thumb to appear immediately.

### Cache-miss at paint time

`useLodSources` returns:

```ts
{
  lodSrc: string,           // blob URL or full-res fallback
  playVideo: boolean,       // videos: full <video> vs poster <img>
  isFallback: boolean,      // true when full-res is used because no cached level fits
}
```

Fallback behaviour: render the full-res source (current behaviour),
schedule generation if not already pending. When the level arrives,
the hook emits an update and the component re-renders with
`lodSrc = <blob url>`. No spinners, no placeholders — the user
always sees *something*.

## Error handling and edge cases

- **Generation failure** (CORS, decode, malformed video): mark asset
  `lodDisabled`, always render full-res. Log once per id via
  `console.warn`. Disabled state is in-memory; clears on reload.
- **Video without extractable poster frame:** same as above. Includes
  codecs that can't seek-to-0 in the current browser.
- **Asset deleted:** `lodCache.delete(assetId)` removes all levels and
  revokes all tracked URLs. Called from `deleteImage` / `deleteVideo`
  success handlers.
- **IndexedDB unavailable** (private mode, quota exceeded, disabled):
  `lodCache` operations become no-ops; the system degrades to "every
  render is fallback". No crash.
- **Worker unavailable** (policy-blocked, extension interference):
  hydration disables itself; everything renders full-res. LoD becomes
  a no-op.
- **Hysteresis:** picker implements 1.25× upgrade threshold (see
  above). Downgrades apply immediately.
- **First run on an existing project:** hydration queue processes
  everything in the background. User sees full-res for seconds until
  baselines land. Acceptable.
- **Source dimensions smaller than `MIN_LEVEL_PX`:** skip LoD for that
  asset — always render full-res. Pyramid generation is skipped.
- **Simultaneous identical hydration requests** (e.g. React strict
  mode double-invoke): the orchestrator dedupes by `assetId` in
  `pending`.

## Testing

**Pure utilities (`mipLevels`, `pickLevel`):** unit tests with Vitest.
Boundary cases:
- Source dim below `MIN_LEVEL_PX` → empty pyramid.
- Source dim between two level values → pyramid includes only levels
  ≤ longest side.
- Non-integer DPR (1.5, 2.625) → picker returns smallest level ≥
  rounded target.
- Target exactly equals a level px → that level is picked, not the
  one above.
- Hysteresis: simulate zoom oscillation, assert no upgrade until
  1.25× threshold crossed.

**Cache (`lodCache`):** tests against `fake-indexeddb`.
- Put/get round-trip returns the same bytes.
- `totalBytes` remains accurate under put + delete churn.
- Eviction deletes only levels > `MIN_LEVEL_PX`, in LRU order, until
  under budget × 0.9.
- Baseline level never evicted regardless of LRU age.
- Concurrent puts don't double-count `totalBytes` (single transaction
  semantics).

**Worker:** smoke test by importing the generator function directly
from `mip.worker.ts` (keep the worker wrapper thin). Full worker
message-passing not easily unit-testable in JSDOM; covered by the
integration test.

**Integration (`Canvas.tsx`):** one RTL test.
- Render 3 media items with mocked source dimensions.
- Mock the worker to synchronously "generate" pre-computed blobs.
- Mount at `scale=0.05` → assert `img.src` resolves to the 64 px mip.
- Change to `scale=2.0` → assert `img.src` swaps to full-res.
- Video item at low zoom → assert `<img>` rendered, not `<video>`.

## Performance targets

- **Steady-state render with 100 media, zoomed out to show all:**
  no more than 1 MB of active texture memory (was up to 500 MB
  pre-LoD depending on source sizes). Below threshold for GPU
  throttling on integrated graphics.
- **Hydration of a 100-item existing project:** < 30 s in the
  background, no frame drops during interaction.
- **Upload hydration:** < 200 ms from upload complete to mip
  available for the common case (~4 MP source image).

These are targets, not gates. Measured with an unscientific eyeball
test on the dev machine; not worth building automated perf
regression tooling for v1.

## Rollout

Single-PR drop, no feature flag. Behind-the-scenes optimization; if
the mip system is disabled entirely (e.g. by a build flag or stubbed
`useLodSources`), the canvas renders exactly as it does today. Merge
safety is high.

## Open questions

None. All design dimensions resolved in brainstorming.
