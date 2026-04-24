# Segmentation Render Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut main-thread cost of mask baking and bbox rendering so big images (many masks, large sources) stay interactive.

**Architecture:**
Three layered changes: (1) replace the per-pixel `Uint16Array` id-map with stored polygon rings + a pure even-odd hit-test (no second rasterization, no full-frame scan, no canvas-context dependency in tests); (2) run `composeBake` in a Web Worker following the existing LoD worker pattern, so base64 decode + marching squares + Chaikin smoothing + ring rasterization leave the main thread; (3) move the at-rest segmentation bboxes from N × 5 DOM nodes per image to a single viewport-space overlay `<canvas>`, keeping only the active selected/hovered bbox as DOM so its resize handles and hover pill retain their pointer-event + focus ergonomics.

**Tech Stack:** React 18, TypeScript strict, Vite, Vitest (node + jsdom workspaces), OffscreenCanvas, Web Workers (ES modules), existing `@netrart/app` monorepo package.

**Branch:** This work is unrelated to `feat/annotation-import` and should live on a new branch. Before starting: `git checkout main && git pull && git checkout -b perf/segmentation-render`.

---

## File Structure

**New files:**
- `apps/app/src/features/segmentation/hitTestMask.ts` — pure even-odd point-in-polygon hit test against stored rings.
- `apps/app/src/features/segmentation/hitTestMask.test.ts` — unit tests for the ring-based hit test.
- `apps/app/src/features/segmentation/worker/compose.worker.ts` — web worker running `composeBake` off the main thread.
- `apps/app/src/features/segmentation/worker/composeWorkerClient.ts` — main-thread client wrapping the worker, with main-thread fallback.
- `apps/app/src/features/segmentation/BboxOverlayLayer.tsx` — viewport-space `<canvas>` that paints at-rest mask bboxes.
- `apps/app/src/features/segmentation/BboxOverlayLayer.test.tsx` — tests for the overlay painter.
- `apps/app/src/features/segmentation/paintBbox.ts` — pure function that draws one bbox (rect + 4 corner ticks) onto a 2D context. Extracted for unit testing.
- `apps/app/src/features/segmentation/paintBbox.test.ts` — tests the paint function against a mock 2D context.

**Modified files:**
- `apps/app/src/features/segmentation/types.ts` — replace `idMap` / `idToMask` with `hitMasks: HitMask[]`.
- `apps/app/src/features/segmentation/compose.ts` — emit `hitMasks` instead of the id-map; drop `idScratch` canvas + full-frame scan.
- `apps/app/src/features/segmentation/hitTest.ts` — **delete** (replaced by `hitTestMask.ts`).
- `apps/app/src/features/segmentation/hitTest.test.ts` — **delete** (replaced).
- `apps/app/src/features/segmentation/SegmentBakeLayer.tsx` — swap id-map sampling for ring hit-test.
- `apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx` — update fixtures to new bake shape.
- `apps/app/src/features/segmentation/bakeCache.ts` — use worker client; keep existing signature/invalidation logic.
- `apps/app/src/features/segmentation/bakeCache.test.tsx` — update fake bake shape.
- `apps/app/src/features/segmentation/index.ts` — re-export `BboxOverlayLayer`.
- `apps/app/src/Canvas.tsx` — remove the at-rest bbox DOM block (`~lines 3175–3252`) and mount `<BboxOverlayLayer />` in its place; pass the data it needs via props.

**Unchanged on purpose:**
- `Canvas.tsx` selected/hover bbox blocks (`~3254–3418`) stay DOM — they need pointer events, focus, resize handles, hover pill.
- User-drawn boxes (`~3115–3146`) stay DOM — out of scope for this plan (separate perf pass).
- `contours.ts`, `bbox.ts`, `dims.ts`, `stroke.ts`, `signature.ts`, `decodeCache.ts` — unchanged.

---

## Task 1: Rings-Based Hit Test (replaces id-map)

**Why first:** Unlocks removing the second rasterization AND the full-frame scan in one go. Landable without worker changes.

**Files:**
- Create: `apps/app/src/features/segmentation/hitTestMask.ts`
- Create: `apps/app/src/features/segmentation/hitTestMask.test.ts`
- Modify: `apps/app/src/features/segmentation/types.ts`
- Modify: `apps/app/src/features/segmentation/compose.ts`
- Modify: `apps/app/src/features/segmentation/SegmentBakeLayer.tsx`
- Modify: `apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx`
- Modify: `apps/app/src/features/segmentation/bakeCache.test.tsx`
- Delete: `apps/app/src/features/segmentation/hitTest.ts`
- Delete: `apps/app/src/features/segmentation/hitTest.test.ts`

### Steps

- [ ] **Step 1.1: Update `types.ts` to model hit masks.**

Replace the file contents with:

```ts
export type MaskIdentity = {
  imageId: string;
  tag: string;
  maskIndex: number;
};

export type ComposeInput = {
  sourceW: number;
  sourceH: number;
  maxSide?: number;
  masks: ReadonlyArray<{
    tag: string;
    maskIndex: number;
    png_base64: string;
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
  }>;
  decodeCache: {
    get: (key: string) => Promise<ImageBitmap>;
  };
};

/**
 * Per-mask hit-test record built by composeBake. `rings` are smoothed
 * polygon rings in bake-pixel space. `bbox` is the axis-aligned bounding
 * rectangle of those rings in bake-pixel space, used as a cheap O(1)
 * pre-filter before the even-odd ring test. Masks are ordered exactly as
 * they were painted, so iterating the array in reverse yields topmost-first.
 */
export type HitMask = {
  tag: string;
  maskIndex: number;
  rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  bbox: { x: number; y: number; w: number; h: number };
};

export type ComposedBake = {
  bitmap: ImageBitmap;
  hitMasks: ReadonlyArray<HitMask>;
  width: number;
  height: number;
};

export type BakeEntry = ComposedBake & {
  signature: string;
};
```

- [ ] **Step 1.2: Write `hitTestMask.ts` with pure point-in-polygon.**

```ts
import type { HitMask, MaskIdentity } from './types';

/**
 * Even-odd point-in-polygon test across all rings of a mask. A point
 * is "inside" the mask when it crosses an odd number of ring edges on
 * a horizontal ray cast to +∞. This matches `canvas.fill(path, 'evenodd')`
 * behaviour used at paint time in compose.ts, so donut masks (outer ring
 * + inner hole) hit-test correctly.
 */
export function pointInMask(
  px: number,
  py: number,
  rings: HitMask['rings'],
): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      // Standard even-odd crossing test.
      const intersects =
        a.y > py !== b.y > py &&
        px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

/**
 * Hit-test a pointer against the topmost mask at that pixel. Returns
 * the mask identity or `null` if the pointer misses every mask or the
 * canvas itself.
 *
 * `rect` is the canvas' on-screen bounding rect. Pointer coordinates
 * are mapped into bake-pixel space by the rect → (bakeW, bakeH) ratio,
 * exactly like the old id-map hit test did.
 */
export function hitTestAtPointer(
  pointer: { pointerX: number; pointerY: number },
  rect: { left: number; top: number; width: number; height: number },
  hitMasks: ReadonlyArray<HitMask>,
  imageId: string,
  bakeW: number,
  bakeH: number,
): MaskIdentity | null {
  const dx = pointer.pointerX - rect.left;
  const dy = pointer.pointerY - rect.top;
  if (dx < 0 || dy < 0 || dx >= rect.width || dy >= rect.height) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bx = (dx / rect.width) * bakeW;
  const by = (dy / rect.height) * bakeH;
  // Topmost wins — iterate in reverse because compose paints in order.
  for (let i = hitMasks.length - 1; i >= 0; i--) {
    const m = hitMasks[i]!;
    if (bx < m.bbox.x || by < m.bbox.y) continue;
    if (bx >= m.bbox.x + m.bbox.w || by >= m.bbox.y + m.bbox.h) continue;
    if (pointInMask(bx, by, m.rings)) {
      return { imageId, tag: m.tag, maskIndex: m.maskIndex };
    }
  }
  return null;
}
```

- [ ] **Step 1.3: Write failing tests in `hitTestMask.test.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import { hitTestAtPointer, pointInMask } from './hitTestMask';
import type { HitMask } from './types';

const square = (x: number, y: number, size: number, tag: string, idx: number): HitMask => ({
  tag,
  maskIndex: idx,
  rings: [[
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]],
  bbox: { x, y, w: size, h: size },
});

describe('pointInMask', () => {
  it('returns true for a point inside a single ring', () => {
    const rings = [[
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]];
    expect(pointInMask(5, 5, rings)).toBe(true);
  });

  it('returns false for a point outside a ring', () => {
    const rings = [[
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]];
    expect(pointInMask(20, 5, rings)).toBe(false);
  });

  it('treats a point in a donut hole as outside (even-odd)', () => {
    const rings = [
      // Outer ring.
      [ { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 } ],
      // Inner hole.
      [ { x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 } ],
    ];
    // Inside outer, outside inner → inside.
    expect(pointInMask(2, 2, rings)).toBe(true);
    // Inside both → outside (hole).
    expect(pointInMask(10, 10, rings)).toBe(false);
  });
});

describe('hitTestAtPointer', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it('returns the topmost mask at a point', () => {
    const under = square(0, 0, 50, 'under', 0);
    const over = square(20, 20, 50, 'over', 0); // overlaps under at (20..50, 20..50)
    const hit = hitTestAtPointer(
      { pointerX: 30, pointerY: 30 },
      rect,
      [under, over],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'over', maskIndex: 0 });
  });

  it('returns null when the pointer is outside every mask', () => {
    const m = square(0, 0, 10, 'cat', 0);
    const hit = hitTestAtPointer(
      { pointerX: 50, pointerY: 50 },
      rect,
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toBeNull();
  });

  it('returns null when the pointer is outside the canvas rect', () => {
    const m = square(0, 0, 100, 'cat', 0);
    const hit = hitTestAtPointer(
      { pointerX: -5, pointerY: 5 },
      rect,
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toBeNull();
  });

  it('maps pointer coords to bake-pixel space via the rect ratio', () => {
    const m = square(0, 0, 10, 'cat', 0); // covers bake pixels (0,0)..(10,10)
    // Canvas rect 200px wide stretching a 100px bake means pointerX=10 → bakeX=5.
    const hit = hitTestAtPointer(
      { pointerX: 10, pointerY: 10 },
      { left: 0, top: 0, width: 200, height: 200 },
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'cat', maskIndex: 0 });
  });
});
```

- [ ] **Step 1.4: Run the tests and verify they fail.**

Run: `pnpm --filter @netrart/app test -- hitTestMask`
Expected: tests fail with "Failed to resolve import './hitTestMask'" (before the module exists) — actually the module was created in Step 1.2, so tests should PASS here. If they fail for any other reason, fix before proceeding.

- [ ] **Step 1.5: Delete the old `hitTest.ts` + test.**

```bash
rm apps/app/src/features/segmentation/hitTest.ts
rm apps/app/src/features/segmentation/hitTest.test.ts
```

- [ ] **Step 1.6: Rewrite `compose.ts` to emit `hitMasks` and drop the id-map pass.**

Replace the file contents with:

```ts
import type { ComposedBake, ComposeInput, HitMask } from './types';
import { capDims } from './dims';
import { strokeWidthFor } from './stroke';
import { extractContours, ringsToPath, smoothChaikin, type Point } from './contours';

const DEFAULT_MAX_SIDE = 4096;
const ALPHA_THRESHOLD = 128;
const FILL_ALPHA = 0.3;
const SMOOTH_ITERATIONS = 2;

type ReadableBitmap = ImageBitmap & { width: number; height: number };

async function getMaskBitmap(
  cache: ComposeInput['decodeCache'],
  b64: string,
): Promise<ReadableBitmap> {
  const bmp = await cache.get(b64);
  return bmp as ReadableBitmap;
}

function readBitmapPixels(bmp: ReadableBitmap): {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const off = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { rgba: data.data, w: bmp.width, h: bmp.height };
}

function ringsBbox(
  rings: ReadonlyArray<ReadonlyArray<Point>>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Compose all ready masks for a single image into one ImageBitmap + a
 * per-mask hit-test record. For each mask:
 *
 *   - Binarize mask alpha at ALPHA_THRESHOLD.
 *   - Extract closed contour rings via marching squares.
 *   - Smooth each ring with Chaikin's algorithm.
 *   - Scale rings from mask-pixel to bake-pixel space.
 *   - Fill the Path2D with the accent color at FILL_ALPHA and stroke
 *     it in white.
 *   - Record the smoothed rings + their bbox so the main thread can
 *     hit-test against them without storing a per-pixel id map.
 *
 * Layering: later masks paint over earlier ones, so iterating the
 * returned `hitMasks` in reverse yields topmost-first.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const hitMasks: HitMask[] = [];
  const edgeLineWidth = Math.max(1, Math.round(strokeWidthFor(w, h) * 0.75));

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);

    const sample = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= mw || y >= mh) return 0;
      const i4 = (y * mw + x) * 4;
      const r = rgba[i4] ?? 0;
      const g = rgba[i4 + 1] ?? 0;
      const b = rgba[i4 + 2] ?? 0;
      const a = rgba[i4 + 3] ?? 0;
      return Math.max(r, g, b, a);
    };

    const rawRings = extractContours(sample, ALPHA_THRESHOLD, mw, mh);
    if (rawRings.length === 0) {
      hitMasks.push({
        tag: m.tag,
        maskIndex: m.maskIndex,
        rings: [],
        bbox: { x: 0, y: 0, w: 0, h: 0 },
      });
      continue;
    }
    const smoothed = rawRings.map((r) => smoothChaikin(r, SMOOTH_ITERATIONS));
    const scaleX = w / mw;
    const scaleY = h / mh;
    // Rings in bake-pixel space — persisted for hit-testing.
    const scaled: Point[][] = smoothed.map((ring) =>
      ring.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
    );
    const path = ringsToPath(scaled);

    vctx.save();
    vctx.globalAlpha = FILL_ALPHA;
    vctx.fillStyle = m.accent;
    vctx.fill(path, 'evenodd');
    vctx.globalAlpha = 1;
    vctx.lineWidth = edgeLineWidth;
    vctx.strokeStyle = '#ffffff';
    vctx.lineJoin = 'round';
    vctx.lineCap = 'round';
    vctx.stroke(path);
    vctx.restore();

    hitMasks.push({
      tag: m.tag,
      maskIndex: m.maskIndex,
      rings: scaled,
      bbox: ringsBbox(scaled),
    });
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, hitMasks, width: w, height: h };
}
```

- [ ] **Step 1.7: Update `SegmentBakeLayer.tsx` to use the new hit test.**

Change the import block (around line 1-10) to:

```tsx
import {
  memo,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSegmentBake, type BakeHookInput } from './bakeCache';
import { hitTestAtPointer } from './hitTestMask';
import type { MaskIdentity } from './types';
```

Replace the `onPointerDown` body (around lines 75-100) with:

```tsx
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !bake) {
      onEmptyPointerDown(e);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = hitTestAtPointer(
      { pointerX: e.clientX, pointerY: e.clientY },
      rect,
      bake.hitMasks,
      imageId,
      bake.width,
      bake.height,
    );
    if (!hit) {
      onEmptyPointerDown(e);
      return;
    }
    e.stopPropagation();
    onMaskSelect(hit);
  };
```

Replace the `lastHoverIdRef` declaration (around line 60) with:

```tsx
  // Track the last mask under the pointer by stable identity string so
  // onMaskHover only fires on transitions.
  const lastHoverKeyRef = useRef<string | null>(null);
```

Replace `handlePointerMove` with:

```tsx
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && onMaskHover && bake) {
      const rect = canvas.getBoundingClientRect();
      const hit = hitTestAtPointer(
        { pointerX: e.clientX, pointerY: e.clientY },
        rect,
        bake.hitMasks,
        imageId,
        bake.width,
        bake.height,
      );
      const key = hit ? `${hit.tag}:${hit.maskIndex}` : null;
      if (key !== lastHoverKeyRef.current) {
        lastHoverKeyRef.current = key;
        onMaskHover(hit);
      }
    }
    onPointerMove?.(e);
  };
```

Replace `handleMouseLeave` with:

```tsx
  const handleMouseLeave = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (lastHoverKeyRef.current !== null && onMaskHover) {
      lastHoverKeyRef.current = null;
      onMaskHover(null);
    }
    onMouseLeave?.(e);
  };
```

- [ ] **Step 1.8: Update `SegmentBakeLayer.test.tsx` fixtures.**

Replace `mkBake` with:

```tsx
const mkBake = (overrides: Partial<BakeEntry> = {}): BakeEntry => ({
  signature: 'sig',
  bitmap: { width: 2, height: 2, close: () => {} } as unknown as ImageBitmap,
  // One mask covering the top-left bake pixel (0,0)..(1,1).
  hitMasks: [
    {
      tag: 'cat',
      maskIndex: 0,
      rings: [[
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]],
      bbox: { x: 0, y: 0, w: 1, h: 1 },
    },
  ],
  width: 2,
  height: 2,
  ...overrides,
});
```

The existing tests should keep working because the canvas rect (400×400 for a 2×2 bake) stretches bake-pixel (0..1) to screen-pixel (0..200) — pointerDown at (101, 201) still lands inside the first mask's bbox and rings. The off-mask tests at (499, 599) now land at bake (~1.99, ~1.99), outside the (0..1, 0..1) mask bbox → null hit.

- [ ] **Step 1.9: Update `bakeCache.test.tsx` `mkFakeBake`.**

Replace with:

```tsx
function mkFakeBake(markerX: number, bitmapId: number): ComposedBake {
  const fake = { id: bitmapId, closed: false, close() { this.closed = true; } };
  const bitmap = fake as unknown as ImageBitmap;
  return {
    bitmap,
    hitMasks: [{
      tag: 'cat',
      maskIndex: 0,
      rings: [[{ x: 0, y: 0 }, { x: markerX, y: 0 }, { x: markerX, y: 1 }]],
      bbox: { x: 0, y: 0, w: markerX, h: 1 },
    }],
    width: 2,
    height: 2,
  };
}
```

Then update the first `expect` in the "invokes compose once on mount" test from `expect(result.current.bake!.idMap[0]).toBe(5);` to `expect(result.current.bake!.hitMasks).toHaveLength(1);` — we just need to verify a bake landed.

- [ ] **Step 1.10: Run the full segmentation test suite.**

Run: `pnpm --filter @netrart/app test -- src/features/segmentation`
Expected: ALL PASS. If `SegmentBakeLayer.test.tsx` still references `idMap` / `idToMask` anywhere, fix the references.

- [ ] **Step 1.11: Run typecheck + full test suite to catch downstream references.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS. If `Canvas.tsx` or any other file references `idMap` / `idToMask` / `hitTestAtPointer` (from the deleted `hitTest.ts`), TypeScript will flag it. Fix each — most likely there are no external references since those fields were consumed inside `SegmentBakeLayer` only.

Run: `pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 1.12: Commit.**

```bash
git add apps/app/src/features/segmentation/
git commit -m "perf(segmentation): ring-based hit test replaces per-pixel id map

Stores smoothed polygon rings + axis-aligned bbox per mask instead of a
per-pixel Uint16Array, eliminating the second rasterization and full-
frame id-map scan in composeBake. Hit testing becomes bbox pre-filter
+ even-odd point-in-polygon, still topmost-wins via reverse iteration."
```

---

## Task 2: Run `composeBake` in a Web Worker

**Why second:** Worker moves all the CPU work (decode, marching squares, smoothing, rasterization) off the main thread. Builds on Task 1's lean bake output — rings are cheap to structured-clone, the bitmap transfers zero-copy.

**Files:**
- Create: `apps/app/src/features/segmentation/worker/compose.worker.ts`
- Create: `apps/app/src/features/segmentation/worker/composeWorkerClient.ts`
- Modify: `apps/app/src/features/segmentation/bakeCache.ts`

### Steps

- [ ] **Step 2.1: Write the worker module.**

Create `apps/app/src/features/segmentation/worker/compose.worker.ts`:

```ts
/// <reference lib="webworker" />
import { composeBake } from '../compose';
import type { ComposedBake } from '../types';

type ComposeJobInput = {
  sourceW: number;
  sourceH: number;
  maxSide?: number;
  masks: ReadonlyArray<{
    tag: string;
    maskIndex: number;
    png_base64: string;
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
  }>;
};

type InMessage = {
  type: 'compose';
  id: number;
  input: ComposeJobInput;
};

type DoneMessage = {
  type: 'done';
  id: number;
  bitmap: ImageBitmap;
  hitMasks: ComposedBake['hitMasks'];
  width: number;
  height: number;
};

type ErrorMessage = {
  type: 'error';
  id: number;
  message: string;
};

export type OutMessage = DoneMessage | ErrorMessage;

const selfRef: DedicatedWorkerGlobalScope = globalThis as unknown as DedicatedWorkerGlobalScope;

/**
 * Worker-local decode cache. Each worker owns its own ImageBitmap cache
 * so the main thread never holds decoded PNGs. Capacity matches the
 * pre-worker main-thread cache.
 */
const DECODE_CAP = 128;
const decoded = new Map<string, ImageBitmap>();

async function decode(b64: string): Promise<ImageBitmap> {
  const existing = decoded.get(b64);
  if (existing) return existing;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  if (decoded.size >= DECODE_CAP) {
    // Evict insertion-order oldest. Good enough for v1.
    const oldest = decoded.keys().next().value;
    if (oldest !== undefined) {
      const old = decoded.get(oldest);
      decoded.delete(oldest);
      old?.close?.();
    }
  }
  decoded.set(b64, bmp);
  return bmp;
}

async function run(job: InMessage): Promise<void> {
  try {
    const composed = await composeBake({
      sourceW: job.input.sourceW,
      sourceH: job.input.sourceH,
      maxSide: job.input.maxSide,
      masks: job.input.masks,
      decodeCache: { get: decode },
    });
    const msg: DoneMessage = {
      type: 'done',
      id: job.id,
      bitmap: composed.bitmap,
      hitMasks: composed.hitMasks,
      width: composed.width,
      height: composed.height,
    };
    selfRef.postMessage(msg, [composed.bitmap]);
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      id: job.id,
      message: err instanceof Error ? err.message : String(err),
    };
    selfRef.postMessage(msg);
  }
}

selfRef.addEventListener('message', (e: MessageEvent<InMessage>) => {
  if (e.data.type === 'compose') void run(e.data);
});
```

- [ ] **Step 2.2: Write the main-thread client.**

Create `apps/app/src/features/segmentation/worker/composeWorkerClient.ts`:

```ts
import type { ComposedBake, ComposeInput } from '../types';
import type { OutMessage } from './compose.worker';

export type ComposeFn = (input: ComposeInput) => Promise<ComposedBake>;

/**
 * Create a main-thread client wrapping `compose.worker.ts`. Returns a
 * function with the same signature as the direct `composeBake` so
 * `useSegmentBake` doesn't care whether the work runs on or off the
 * main thread.
 *
 * Returns `null` if workers are unavailable (policy-blocked, test envs,
 * etc.). Callers should fall back to the main-thread `composeBake`.
 *
 * Note: `input.decodeCache` is IGNORED by the worker path. The worker
 * owns its own decode cache. Callers that pass a decode cache for the
 * main-thread fallback should keep doing so.
 */
export function createComposeWorker(): {
  compose: ComposeFn;
  terminate: () => void;
} | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./compose.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    console.warn('[segmentation] compose worker unavailable; falling back to main thread', err);
    return null;
  }

  let nextId = 1;
  const resolvers = new Map<number, (bake: ComposedBake) => void>();
  const rejecters = new Map<number, (err: Error) => void>();

  worker.addEventListener('message', (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    if (msg.type === 'done') {
      const resolve = resolvers.get(msg.id);
      resolvers.delete(msg.id);
      rejecters.delete(msg.id);
      resolve?.({
        bitmap: msg.bitmap,
        hitMasks: msg.hitMasks,
        width: msg.width,
        height: msg.height,
      });
    } else if (msg.type === 'error') {
      const reject = rejecters.get(msg.id);
      resolvers.delete(msg.id);
      rejecters.delete(msg.id);
      reject?.(new Error(msg.message));
    }
  });

  return {
    compose(input) {
      return new Promise<ComposedBake>((resolve, reject) => {
        const id = nextId++;
        resolvers.set(id, resolve);
        rejecters.set(id, reject);
        worker.postMessage({
          type: 'compose',
          id,
          input: {
            sourceW: input.sourceW,
            sourceH: input.sourceH,
            maxSide: input.maxSide,
            masks: input.masks,
          },
        });
      });
    },
    terminate() {
      worker.terminate();
    },
  };
}
```

- [ ] **Step 2.3: Wire the worker into `bakeCache.ts`.**

Replace the top of `bakeCache.ts` (everything up to the `useSegmentBake` hook) with:

```ts
import { useEffect, useRef, useState } from 'react';
import type { BakeEntry, ComposedBake, ComposeInput } from './types';
import { composeBake as defaultComposeBake } from './compose';
import { computeSignature } from './signature';
import { createDecodeCache } from './decodeCache';
import { createComposeWorker } from './worker/composeWorkerClient';

const DECODE_CAP = 128;
const BAKE_CAP = 32;

// Main-thread decode cache. Only used by the fallback path when the
// worker is unavailable (the worker owns its own cache).
const decodeCache = createDecodeCache<ImageBitmap>({
  capacity: DECODE_CAP,
  decode: async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    return await createImageBitmap(blob);
  },
  closeBitmap: (b) => {
    b.close();
  },
});

const bakeStore = new Map<string, BakeEntry>();

function evictBakeStore() {
  while (bakeStore.size > BAKE_CAP) {
    const oldest = bakeStore.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = bakeStore.get(oldest);
    bakeStore.delete(oldest);
    entry?.bitmap.close();
  }
}

export function evictBake(imageId: string): void {
  const entry = bakeStore.get(imageId);
  if (!entry) return;
  bakeStore.delete(imageId);
  entry.bitmap.close();
}

export function evictDecode(png_base64: string): void {
  decodeCache.drop(png_base64);
}

// Lazily create the worker on first use so SSR / tests don't pay for
// one. If it fails to construct, fall back to the main-thread compose.
let workerClient: ReturnType<typeof createComposeWorker> = null;
let workerAttempted = false;

function resolveCompose(): (input: ComposeInput) => Promise<ComposedBake> {
  if (!workerAttempted) {
    workerAttempted = true;
    workerClient = createComposeWorker();
  }
  if (workerClient) return workerClient.compose;
  return defaultComposeBake;
}

// Test seam: swap composeBake. Default is the real one (worker-backed
// in production). Tests can inject a synchronous fake here to keep the
// hook deterministic.
let composeFn: (input: ComposeInput) => Promise<ComposedBake> | null = null as unknown as (input: ComposeInput) => Promise<ComposedBake>;

export function __setComposeForTests(
  fn: (input: ComposeInput) => Promise<ComposedBake>,
): void {
  composeFn = fn;
}

export function __resetBakeCacheForTests(): void {
  bakeStore.clear();
  composeFn = null as unknown as (input: ComposeInput) => Promise<ComposedBake>;
  workerClient?.terminate();
  workerClient = null;
  workerAttempted = false;
}
```

Then in `useSegmentBake`, change the single `composeFn` call site to use the resolver:

```ts
    (async () => {
      const current = inputRef.current;
      const compose = composeFn ?? resolveCompose();
      const composed = await compose({
        sourceW: current.sourceW,
        sourceH: current.sourceH,
        masks: current.masks,
        decodeCache,
      });
      // ... rest of the body unchanged
```

- [ ] **Step 2.4: Run segmentation tests.**

Run: `pnpm --filter @netrart/app test -- src/features/segmentation`
Expected: PASS. Tests use `__setComposeForTests` so they never touch the worker path.

- [ ] **Step 2.5: Manual smoke in dev.**

Run: `pnpm --filter @netrart/app dev`
Then in the app: import an image, run segmentation on it, verify masks render and hit-testing works. Open DevTools → Performance → record a bake — confirm main-thread time for compose is near-zero and the work shows up under a worker thread. If any regressions, fix before committing.

Document result inline: *"Manual smoke in dev: bake shows on worker thread, main-thread time < 10ms for 10-mask bake on 4K image."* (Replace with actual observation.)

- [ ] **Step 2.6: Run typecheck + full test suite.**

Run: `pnpm --filter @netrart/app typecheck && pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 2.7: Commit.**

```bash
git add apps/app/src/features/segmentation/
git commit -m "perf(segmentation): run composeBake in a web worker

Decode + marching squares + smoothing + rasterization move off the main
thread. Worker owns its own ImageBitmap decode cache; main thread
transfers the resulting ImageBitmap zero-copy and structured-clones the
per-mask rings. Falls back to main-thread compose when workers are
unavailable (same pattern as features/lod)."
```

---

## Task 3: Bbox DOM → Canvas Overlay (at-rest bboxes only)

**Why last:** Lowest blast radius — the change is contained to one DOM block in Canvas.tsx. Selected / hovered bboxes stay DOM so resize handles and the hover pill keep working.

**Files:**
- Create: `apps/app/src/features/segmentation/paintBbox.ts`
- Create: `apps/app/src/features/segmentation/paintBbox.test.ts`
- Create: `apps/app/src/features/segmentation/BboxOverlayLayer.tsx`
- Create: `apps/app/src/features/segmentation/BboxOverlayLayer.test.tsx`
- Modify: `apps/app/src/features/segmentation/index.ts`
- Modify: `apps/app/src/Canvas.tsx`

### Steps

- [ ] **Step 3.1: Extract the bbox paint primitive.**

Create `apps/app/src/features/segmentation/paintBbox.ts`:

```ts
/**
 * Paint one at-rest bbox (rect + 4 corner ticks) onto a 2D context.
 * Mirrors `.segment-mask-bbox` CSS in App.css:
 *   - 1px rect stroke at 55% accent alpha, 3px corner radius.
 *   - 6x6 corner tick marks in 1.5px solid accent.
 *
 * Coordinates are in viewport pixels. Caller is responsible for
 * applying devicePixelRatio via `ctx.setTransform` before calling.
 */
export function paintBbox(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  rect: { left: number; top: number; width: number; height: number },
  accent: string,
): void {
  const { left, top, width, height } = rect;
  if (width <= 0 || height <= 0) return;

  ctx.save();
  // Dim rect. `color-mix(srgb, accent 55%, transparent)` is approximated
  // here by globalAlpha; the accent CSS var carries the hue.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  roundRectPath(ctx, left + 0.5, top + 0.5, width - 1, height - 1, 3);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Corner ticks: 6×6 L-shapes at each corner, 1.5px stroke. Drawn as
  // two line segments per corner.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  const tick = 6;
  const t = 0.75; // half of 1.5px stroke → pixel-align the inside of the L
  // Top-left
  ctx.beginPath();
  ctx.moveTo(left + tick, top + t);
  ctx.lineTo(left + t, top + t);
  ctx.lineTo(left + t, top + tick);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(left + width - tick, top + t);
  ctx.lineTo(left + width - t, top + t);
  ctx.lineTo(left + width - t, top + tick);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(left + t, top + height - tick);
  ctx.lineTo(left + t, top + height - t);
  ctx.lineTo(left + tick, top + height - t);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(left + width - tick, top + height - t);
  ctx.lineTo(left + width - t, top + height - t);
  ctx.lineTo(left + width - t, top + height - tick);
  ctx.stroke();

  ctx.restore();
}

function roundRectPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
```

- [ ] **Step 3.2: Test paintBbox against a recording mock context.**

Create `apps/app/src/features/segmentation/paintBbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paintBbox } from './paintBbox';

type Call = { method: string; args: unknown[] };

function mockCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const ctx = {
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    stroke: rec('stroke'),
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('paintBbox', () => {
  it('draws nothing for a zero-sized rect', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 0, top: 0, width: 0, height: 10 }, '#ff0000');
    expect(calls.some((c) => c.method === 'stroke')).toBe(false);
  });

  it('strokes the outer rect plus 4 corner ticks', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 10, top: 20, width: 100, height: 50 }, '#ff0000');
    // 1 rect stroke + 4 corner-tick strokes = 5 calls to stroke().
    const strokeCount = calls.filter((c) => c.method === 'stroke').length;
    expect(strokeCount).toBe(5);
  });
});
```

Run: `pnpm --filter @netrart/app test -- paintBbox`
Expected: PASS.

- [ ] **Step 3.3: Write the overlay component.**

Create `apps/app/src/features/segmentation/BboxOverlayLayer.tsx`:

```tsx
import { memo, useEffect, useRef } from 'react';
import { paintBbox } from './paintBbox';

export type BboxOverlayRect = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  accent: string;
};

export type BboxOverlayLayerProps = {
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /** Viewport height in CSS pixels. */
  viewportHeight: number;
  /** At-rest bbox rects in viewport coords. Excludes selected / hovered
   *  masks — those remain DOM for interactivity. */
  rects: ReadonlyArray<BboxOverlayRect>;
};

/**
 * Viewport-space canvas that paints every at-rest segmentation bbox in
 * one pass. Replaces N × 5 DOM nodes (one <div> + four <span> ticks per
 * bbox) with a single <canvas>. Fixed-positioned, pointer-events none
 * so clicks fall through to the underlying image + bake layers.
 */
function BboxOverlayLayerImpl({
  viewportWidth,
  viewportHeight,
  rects,
}: BboxOverlayLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(viewportWidth * dpr));
    const pxH = Math.max(1, Math.round(viewportHeight * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    for (const r of rects) {
      paintBbox(
        ctx,
        { left: r.left, top: r.top, width: r.width, height: r.height },
        r.accent,
      );
    }
  }, [viewportWidth, viewportHeight, rects]);

  return (
    <canvas
      ref={canvasRef}
      className="segment-bbox-overlay"
      aria-hidden
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: viewportWidth,
        height: viewportHeight,
        pointerEvents: 'none',
        zIndex: 12, // matches .segment-mask-bbox z-index so DOM chrome still stacks above when present
      }}
    />
  );
}

export const BboxOverlayLayer = memo(BboxOverlayLayerImpl);
```

- [ ] **Step 3.4: Write overlay test.**

Create `apps/app/src/features/segmentation/BboxOverlayLayer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { BboxOverlayLayer, type BboxOverlayRect } from './BboxOverlayLayer';

beforeEach(() => {
  // jsdom has no 2d context; stub with a recording mock that satisfies
  // the shape the effect touches.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    stroke: () => {},
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('BboxOverlayLayer', () => {
  it('renders a fixed canvas sized to the viewport', () => {
    const { container } = render(
      <BboxOverlayLayer viewportWidth={800} viewportHeight={600} rects={[]} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.style.position).toBe('fixed');
    expect(canvas!.style.width).toBe('800px');
    expect(canvas!.style.height).toBe('600px');
    expect(canvas!.style.pointerEvents).toBe('none');
  });

  it('is aria-hidden so it does not affect a11y trees', () => {
    const { container } = render(
      <BboxOverlayLayer viewportWidth={400} viewportHeight={300} rects={[]} />,
    );
    expect(container.querySelector('canvas')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('accepts a list of rects without crashing', () => {
    const rects: BboxOverlayRect[] = [
      { key: 'a', left: 10, top: 20, width: 100, height: 50, accent: '#f00' },
      { key: 'b', left: 200, top: 30, width: 60, height: 40, accent: '#0f0' },
    ];
    const { container } = render(
      <BboxOverlayLayer viewportWidth={400} viewportHeight={300} rects={rects} />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });
});
```

Run: `pnpm --filter @netrart/app test -- BboxOverlayLayer`
Expected: PASS.

- [ ] **Step 3.5: Export `BboxOverlayLayer` from the feature.**

Modify `apps/app/src/features/segmentation/index.ts` to add:

```ts
export { BboxOverlayLayer, type BboxOverlayRect } from './BboxOverlayLayer';
```

- [ ] **Step 3.6: Mount the overlay in `Canvas.tsx` and remove the at-rest DOM block.**

In the import block at the top of `Canvas.tsx`, add `BboxOverlayLayer` and `BboxOverlayRect` to the existing `@/features/segmentation` (or relative) import (match the existing path).

Find the at-rest bbox rendering block (starts with the comment `// Dim "at-rest" bbox for every ready mask on every visible image.` at ~line 2986 and ends at ~line 3252 — the full `(() => { ... })()` IIFE that builds `rects` and returns `rects.map(...)`).

Replace the entire IIFE (and its outer `{ }` JSX braces) with:

```tsx
{(() => {
  // At-rest bboxes are painted to a single viewport-space <canvas> via
  // BboxOverlayLayer. The active (selected / hovered) mask is still
  // rendered as DOM below so its resize handles + hover pill keep
  // working.
  const sel = selectedMask;
  const hov = hoveredMask;
  const activeId = activeMedia?.id ?? null;
  const soloLower = soloTag ? soloTag.toLowerCase() : null;
  const rects: BboxOverlayRect[] = [];
  for (const m of paintMedia) {
    if (m.kind !== 'image') continue;
    const state = segments[m.id];
    if (!state) continue;
    for (const entry of state.entries) {
      if (entry.status !== 'ready') continue;
      const tagLower = entry.tag.toLowerCase();
      if (soloLower && m.id === activeId && tagLower !== soloLower) continue;
      const { accent } = colorForTag(entry.tag);
      for (let i = 0; i < entry.response.masks.length; i += 1) {
        const mask = entry.response.masks[i];
        if (!mask || !mask.bbox) continue;
        const isSel =
          sel &&
          sel.imageId === m.id &&
          sel.tag.toLowerCase() === tagLower &&
          sel.maskIndex === i;
        const isHov =
          hov &&
          hov.imageId === m.id &&
          hov.tag.toLowerCase() === tagLower &&
          hov.maskIndex === i;
        if (isSel || isHov) continue;
        const [x1, y1, x2, y2] = mask.bbox;
        const fx = m.width / mask.width;
        const fy = m.height / mask.height;
        rects.push({
          key: `${m.id}-${entry.tag}-${i}`,
          left: (m.x + x1 * fx) * view.scale + view.x,
          top: (m.y + y1 * fy) * view.scale + view.y,
          width: Math.max(1, (x2 - x1) * fx) * view.scale,
          height: Math.max(1, (y2 - y1) * fy) * view.scale,
          accent,
        });
      }
    }
  }
  return (
    <BboxOverlayLayer
      viewportWidth={viewportSize.width}
      viewportHeight={viewportSize.height}
      rects={rects}
    />
  );
})()}
```

If `viewportSize` isn't already available in scope: there's almost certainly an existing resize-observed size or `window.innerWidth/innerHeight`-derived value. Grep `Canvas.tsx` for `innerWidth` or `ResizeObserver` and use that. If neither exists, add `const viewportSize = { width: window.innerWidth, height: window.innerHeight };` as a stopgap (not ideal — follow with a window resize listener in a separate commit if needed). **Check this before editing** — don't invent state that's already modelled.

- [ ] **Step 3.7: Verify the typecheck passes.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS. If the `BboxOverlayRect` type import is missing, fix it.

- [ ] **Step 3.8: Run full test suite.**

Run: `pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 3.9: Manual smoke in dev.**

Run: `pnpm --filter @netrart/app dev`
In the app: load an image with multiple masks (≥5), then:
- Confirm every mask still has its dim at-rest bbox visible.
- Hover one mask → the active hover chrome still renders (DOM path), the overlay continues to show at-rest bboxes for the others.
- Click one mask → the selection chrome + resize handles render (DOM path).
- Zoom in and out → bbox strokes stay 1px crisp at every zoom (the whole point of this change).
- Pan → overlay redraws correctly with the new view transform.

Document observations inline in the commit body.

- [ ] **Step 3.10: Commit.**

```bash
git add apps/app/src/features/segmentation/ apps/app/src/Canvas.tsx
git commit -m "perf(segmentation): paint at-rest bboxes to a viewport overlay canvas

Replaces N × 5 DOM nodes per image (one div + four corner-tick spans)
with a single fixed-position canvas that paints every at-rest bbox in
one pass at devicePixelRatio. Selected / hovered bboxes stay DOM so
resize handles and the hover pill keep working."
```

---

## Self-Review Checklist

Run through this after implementing all tasks, before handoff:

1. **Spec coverage:**
   - [ ] Path2D / rings hit test — Task 1.
   - [ ] Web Worker for composeBake — Task 2.
   - [ ] Bbox DOM → canvas overlay — Task 3.
   - [ ] Id-map scan scoping — superseded by Task 1 (no id-map at all).

2. **No stray `idMap` references:**
   Run: `grep -rn "idMap\|idToMask" apps/app/src`
   Expected: no matches.

3. **No stray `hitTestAtPointer` imports from the deleted module:**
   Run: `grep -rn "from './hitTest'" apps/app/src/features/segmentation`
   Expected: no matches. All imports should be from `./hitTestMask`.

4. **Types consistent end-to-end:**
   - `HitMask` shape matches between worker message, compose output, and hit-test input.
   - `BboxOverlayRect` is imported consistently.

5. **Worker fallback path compiles:**
   - `resolveCompose()` returns `defaultComposeBake` when `createComposeWorker` returns null. Tests run in node/jsdom without a Worker implementation — `__setComposeForTests` masks this but the fallback should still work if a test exercises it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-segmentation-render-perf.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
