# Baked Segmentation Overlay — Design

Date: 2026-04-24
Status: proposed
Area: `apps/app` — Canvas / SAM3 segmentation rendering

## Problem

For every visible image with SAM3 segmentations, the canvas renders one
`<div class="segment-mask">` per mask (CSS `mask-image` tinted fill) and
one `<div class="segment-bbox">` per mask. An image with several tags
and multiple masks per tag produces dozens of `position: fixed` DOM
nodes, each re-styled on every pan/zoom frame, with the browser
decoding a per-mask base64 PNG data URL. See
`apps/app/src/Canvas.tsx:2147-2213`.

We also need to add interactive selection and per-mask deletion on top
of these overlays, which a flat baked image cannot support.

## Goal

- Pan/zoom cost for segmented images drops to one transform update per
  image regardless of mask count.
- Selecting and deleting an individual mask is pixel-accurate, even
  when masks from different tags overlap.
- No regression in visual fidelity versus the current CSS-mask
  rendering.

## Approach

Replace the N-divs-per-image model with **one `<canvas>` per visible
image with ready segmentations, mounted inside `.ic-content` in world
coordinates**. Composite masks + bounding boxes into the canvas once
per segmentation-state change. Maintain a parallel `Uint16Array` id-map
at the same resolution for pixel-perfect hit-testing. Loading/error
chips stay DOM (they render text, update independently, and shouldn't
invalidate the bake).

The current mask overlays are `position: fixed` at *screen*
coordinates (`rx = m.x * view.scale + view.x`, etc.), which forces
per-frame style updates during pan/zoom. The canvas replacement lives
*inside* `InfiniteCanvas`'s `.ic-content` container, which is itself
driven by a single CSS `transform: translate3d(...) scale(...)`
updated imperatively in `InfiniteCanvas.tsx:113-130`. Children of
`.ic-content` — like the `<img>` itself — use world coords
(`left: m.x`, `width: m.width`) and never re-render on pan/zoom. Our
bake canvas inherits that property for free.

```
Current:                          Proposed:
  <img src=image/>                   <img src=image/>
  <div.segment-mask/> × M            <canvas.segment-bake/>    ← 1 node, baked once
  <div.segment-bbox/> × M            (+ id-map in memory)
  <div.segment-overlay--chips/>      <div.segment-overlay--chips/>   (unchanged)
```

## Components

### 1. `composeBake` — pure composer

Signature:

```ts
composeBake(input: {
  // Bake-canvas target resolution. Typically the image's SAM3
  // source_width/source_height (they're consistent within one image),
  // capped at `maxSide`.
  sourceW: number;
  sourceH: number;
  maxSide?: number;            // default 2048
  masks: Array<{
    tag: string;
    maskIndex: number;
    png_base64: string;
    // Each mask's own pixel dims; may differ from sourceW/sourceH.
    // All of a mask's coordinates (the mask pixels AND its bbox) are
    // in this mask-local pixel space, which we rescale into the bake
    // canvas' space.
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
  }>;
  decodeCache: Map<string, ImageBitmap>;
}): Promise<{
  bitmap: ImageBitmap;
  idMap: Uint16Array;
  idToMask: Array<{ tag: string; maskIndex: number }>;
  width: number;      // bake canvas width
  height: number;     // bake canvas height
}>;
```

Steps:

1. Decode each mask PNG to `ImageBitmap`, using `decodeCache` to avoid
   re-decoding identical base64 payloads across bakes.
2. Compute bake canvas dims: `(w, h) = cap(sourceW, sourceH,
   maxSide)`. Allocate two `OffscreenCanvas`es at `w × h`. Allocate
   `idMap = new Uint16Array(w * h)`.
3. For each mask `i` (1-based):
   - **Visual pass.** Draw the mask bitmap onto a scratch canvas
     using `drawImage(bmp, 0, 0, w, h)` so it is rescaled from its
     `maskW × maskH` into the bake canvas' space. Set
     `globalCompositeOperation = 'source-in'`; fill the scratch with
     `accent`. Draw the scratch onto the visible canvas at
     `globalAlpha = 0.5`.
   - **Bbox stroke.** Scale the bbox from mask-pixel space into bake
     space: `sx = w / maskW`, `sy = h / maskH`, then stroke
     `rect(x1*sx, y1*sy, (x2-x1)*sx, (y2-y1)*sy)` in `accent` with
     `lineWidth = max(2, round(max(w, h) / 1000))`.
   - **Id pass.** Rasterize the rescaled mask into a scratch canvas
     at `w × h`; read pixels via `getImageData`; for each pixel whose
     alpha/luminance exceeds a threshold (e.g., 128), write `i` into
     `idMap[y*w + x]`. Append `{ tag, maskIndex }` to `idToMask`
     (index `i - 1`).
4. `offscreen.transferToImageBitmap()` → return `{ bitmap, idMap,
   idToMask, width, height }`.

Pure and testable: given fixture masks and accents, snapshot the
bitmap pixel hash and the idMap; no DOM needed.

### 2. `useSegmentBake(image, entries)` — cache hook

- Holds a `Map<imageId, BakeEntry>` across renders (module-level ref
  or ref passed via context):

  ```ts
  type BakeEntry = {
    signature: string;
    bitmap: ImageBitmap;
    idMap: Uint16Array;
    idToMask: Array<{ tag: string; maskIndex: number }>;
    w: number;
    h: number;
  };
  ```

- Signature = deterministic fingerprint of `entries` filtered to
  `status === 'ready'`: ordered list of
  `(tagLowerCased, maskIndex, png_base64.length, first16+last16 of
  base64)`. Cheap; collision-safe enough for mask content identity.
- On signature change: invoke `composeBake`, replace the entry, close
  the prior `ImageBitmap` when its entry is evicted.
- On `clearSegment(id)` (see `Canvas.tsx:1174-1187`) or `dropAsset(id)`
  (`Canvas.tsx:1351-1380`): evict the entry, close its bitmap.

### 3. `SegmentBakeLayer` — render component

- Replaces the per-mask `.flatMap` at `Canvas.tsx:2147-2213`.
- Mounted **inside `.ic-content`** (sibling of the world-coord
  `<img>`), positioned in world coords:
  `style={{ left: m.x, top: m.y, width: m.width, height: m.height }}`.
  The container transform handles pan/zoom, so the canvas never needs
  to re-render for view changes.
- Internal pixel buffer is `bake.w × bake.h` (set via the canvas'
  `width`/`height` attributes); CSS stretches it to world dims. The
  `.ic-content` transform then scales it visually.
- Effect: on bake change, `canvas.getContext('bitmaprenderer')
  .transferFromImageBitmap(bake.bitmap)` — zero-copy publish.
- `pointer-events: auto`, sits above the `<img>` via z-index.
- Receives the same `onPointerDown` / `onClick` / `onContextMenu` /
  etc. props that `MediaItem` receives (see
  `Canvas.tsx:392-406`). On empty-pixel hits it forwards to those
  callbacks; on mask hits it calls `onMaskSelect(...)`. No handler
  refactor required — Canvas already threads these handlers as props.
- The loading/error chip overlay continues to render in screen coords
  with the same math as today, unchanged (`Canvas.tsx:2220-2258`).

### 4. Hit-testing & selection

- On `pointerdown` on the canvas, compute the image-local pixel coord
  from the canvas' own bounding rect (the canvas is inside
  `.ic-content`, so its rect already reflects pan/zoom):

  ```
  const rect = canvas.getBoundingClientRect();
  const cx = floor((e.clientX - rect.left) / rect.width  * bake.w);
  const cy = floor((e.clientY - rect.top)  / rect.height * bake.h);
  const id = bake.idMap[cy * bake.w + cx];   // 0 = empty
  ```

- `id > 0` → call `onMaskSelect({ imageId, tag, maskIndex })`, which
  sets a Canvas-level `selectedMask: { imageId, tag, maskIndex } | null`.
  `stopPropagation`.
- `id === 0` → invoke the image's `onPointerDown(e, m)` handler that
  Canvas already passes into `MediaItem`. Same signature, same
  callback — nothing new to lift.
- Selecting a mask clears `selectedIds` (image selection); selecting
  an image clears `selectedMask`. They are mutually exclusive.
- Selection visual: a single `<div class="segment-mask-selected">`
  mounted inside `.ic-content` alongside the bake canvas, positioned
  in **world coords**: translate the mask's bbox from mask-pixel
  space to world space using the image's world rect
  (`left = m.x + x1 * (m.width / maskW)`, etc.), drawn with a 2px
  accent ring + subtle outer glow. Riding inside `.ic-content` means
  pan/zoom is free. One node, no re-bake.
- Hover: throttled (`requestAnimationFrame`) `pointermove` samples
  the id-map and sets `cursor: pointer` when hovering a mask.

### 5. Deletion

- Keybinding: `Delete` / `Backspace` when `selectedMask` is set.
  Input-field focus is respected (`INPUT`, `TEXTAREA`, contentEditable
  targets are ignored). A visible delete affordance (e.g., a small
  `×` chip anchored to the ring) is a sensible follow-up if
  keyboard-only proves undiscoverable; deferred to avoid shipping UX
  that may not be needed.
- `deleteMask({ imageId, tag, maskIndex })`:
  1. Update `segments` state: remove the mask from that tag's
     `response.masks[]`. If the tag now has `masks.length === 0`, drop
     the entire tag entry from `entries[]`. If `entries[]` is empty,
     drop `segments[imageId]`.
  2. Persist:
     - If tag still has masks → `upsertSegmentation` with the shrunk
       `masks[]`.
     - If tag now has no masks → new helper
       `deleteSegmentationByImageTag(imageId, tag)` in `lib/pb.ts`,
       alongside the existing `upsertSegmentation` and
       `deleteAllSegmentationsForImage`.
  3. Clear `selectedMask`.
  4. Signature changes → `useSegmentBake` re-bakes automatically.

## Data model

No schema changes. `SegmentationRow.masks: SegMask[]` already supports
variable-length mask arrays. Deletion is modeled as shrinking that
array or deleting the row when it empties.

## Invalidation

The bake entry's signature is the single invalidation key. Events that
change the signature:

- New mask arrives (`submitSegment` result).
- Mask deleted (user delete).
- Tag cleared via existing tag-input flow.
- Segmentation reloaded from PB (`groupSegmentationsByImage`).

Events that **do not** change the signature:

- Pan / zoom.
- Image selection.
- Mask selection / hover.
- Loading / error chip state changes.

## Resolution policy

Bake resolution = `cap(response.source_width, response.source_height,
maxSide=2048)`. All of one image's masks share that source size
(SAM3 invariant). Downscale masks when the cap kicks in. This keeps
memory bounded (4 bytes × 2048² ≈ 16 MB max per image for RGBA +
2 bytes × 2048² = 8 MB for idMap = ≤ 24 MB worst-case, typically far
less).

## Lifecycle & memory

- Bake cache is a `Map<imageId, BakeEntry>` with soft LRU cap (e.g.,
  32 entries). Mounted images always win over unmounted cached ones
  during eviction.
- Decoded mask `ImageBitmap` cache keyed by `png_base64` with its own
  LRU cap (e.g., 128 bitmaps), `.close()` on eviction.
- Eviction paths:
  - `clearSegment(imageId)` → evict bake entry for that image.
  - `dropAsset(imageId)` (image deletion) → evict bake + any of its
    cached mask bitmaps.
- App unmount: best-effort `.close()` of all surviving bitmaps.

## Testing

- **Pure unit tests** (no DOM): `composeBake` with fixture masks —
  assert idMap values at known pixel coords, assert `idToMask` order,
  assert bitmap dimensions. Use `node-canvas` or a browser-mode Vitest
  entry; the project already has `vitest.workspace.ts` we can extend.
- **Pure unit tests** for the hit-test coord conversion (given rect +
  bake dims + pointer, expect the right idMap index).
- **Pure unit tests** for the signature fingerprint (equal inputs →
  equal output; any entry change → different output).
- **Manual verification checklist**:
  - Pan/zoom at 60 fps on an image with ≥ 10 masks across 3+ tags.
  - Visual parity with current renderer (side-by-side at a few zoom
    levels).
  - Click a mask, see selection ring; press Delete; mask is gone in
    UI and persists as gone after reload.
  - Click empty canvas pixel on a segmented image → image drag still
    works.
  - Overlapping masks: topmost-by-composite-order wins the click.
  - Loading chip still animates while a new tag is being computed.

## Scope / YAGNI

Explicitly **not** in this change:

- Migration to a single global canvas for the whole infinite canvas.
- Multi-mask selection.
- Mask drag / resize / transform.
- Worker-ized compositing (deferred follow-up if first-paint jank is
  observed on very large images).
- Per-pixel selection across images (mask selection is scoped to one
  image at a time, same as image selection is scoped).

## Touch list

Files we'll edit:

- `apps/app/src/Canvas.tsx` — swap the overlay `.flatMap` block for
  `<SegmentBakeLayer>` usage, add `selectedMask` state + Delete
  keybinding + mutual-exclusion with image selection, thread the
  existing `onPointerDown`/`onClick`/`onContextMenu` handlers into the
  bake layer, render the world-coord selection-ring div.
- `apps/app/src/App.css` — add `.segment-bake` and
  `.segment-mask-selected` rules; remove (or leave dormant)
  `.segment-mask` / `.segment-bbox`.
- `apps/app/src/lib/pb.ts` — add `deleteSegmentationByImageTag`.

Files we'll create:

- `apps/app/src/features/segmentation/compose.ts` — `composeBake`.
- `apps/app/src/features/segmentation/bakeCache.ts` — `BakeEntry`,
  `useSegmentBake`.
- `apps/app/src/features/segmentation/SegmentBakeLayer.tsx` —
  rendering + pointer handling.
- `apps/app/src/features/segmentation/hitTest.ts` — coord conversion.
- Matching `*.test.ts` files for the pure units.

## Risks

- **`OffscreenCanvas` support.** The app targets Tauri (Chromium) and
  modern browsers; `OffscreenCanvas` + `ImageBitmap` are fine there.
  No fallback needed.
- **Stroke thickness on very small bakes.** Bbox stroke is baked at
  mask-pixel resolution and then scaled by CSS + the `.ic-content`
  transform, so thickness at display varies with zoom and with the
  ratio `bake.w / m.width`. We stroke at
  `lineWidth = max(2, round(max(bake.w, bake.h) / 1000))` at bake
  time — roughly 2px on modest images, a few px on very large ones.
  Final on-screen thickness also rides the view zoom, same as the
  image itself, which is the desired behavior (annotations scale with
  the pixels they annotate).
- **Selection-ring sharpness under heavy zoom.** The selection ring is
  a DOM div at world coords, sitting inside `.ic-content`. Its border
  renders at `1 / view.scale` CSS pixels when zoomed in beyond 1×,
  which is fine for screen pixels but means the ring appears hairline
  when zoomed way in. If this becomes a usability issue we can use a
  CSS variable (`var(--inv-view-scale)`, already set on `.ic-content`
  at `InfiniteCanvas.tsx:118`) to keep border width view-independent.
- **Event forwarding fidelity.** None — `MediaItem` already receives
  `onPointerDown`/`onClick`/`onContextMenu`/etc. as props. The bake
  layer receives the same props and calls them verbatim on empty-pixel
  hits. No behavior change for the `<img>` path.

## Rollout

Single PR. No feature flag — the replacement is drop-in for segmented
images; unsegmented images are unaffected. Manual verification as
above before merge.
