# Baked Segmentation Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-mask DOM overlays with a single composited
canvas per segmented image, with a pixel-accurate id-map enabling
interactive per-mask selection and deletion.

**Architecture:** A new `features/segmentation/` module exposes a pure
`composeBake` composer (+ pure helpers for dim-capping, bbox scaling,
stroke width, id-map build, signature, hit-test), a `useSegmentBake`
hook that caches per-image bakes, and a `SegmentBakeLayer` component
that mounts one `<canvas>` per segmented image inside
`.ic-content`. Canvas.tsx swaps the `.flatMap` overlay block for this
single-layer rendering, adds `selectedMask` state with a Delete
keybinding, and persists per-mask deletions through a new
`deleteSegmentationByImageTag` helper in `lib/pb.ts`.

**Tech Stack:** TypeScript, React, Vitest (workspace split: `.test.ts`
in node, `.test.tsx` in jsdom), OffscreenCanvas, ImageBitmap, IDB LRU,
PocketBase.

**Reference spec:** `docs/superpowers/specs/2026-04-24-overlay-baking-design.md`

---

## File Structure

### New files

- `apps/app/src/features/segmentation/types.ts` — shared types
  (`BakeEntry`, `ComposedBake`, `MaskIdentity`, `ComposeInput`).
- `apps/app/src/features/segmentation/dims.ts` — `capDims` pure helper.
- `apps/app/src/features/segmentation/dims.test.ts`
- `apps/app/src/features/segmentation/stroke.ts` — `strokeWidthFor`.
- `apps/app/src/features/segmentation/stroke.test.ts`
- `apps/app/src/features/segmentation/bbox.ts` — `scaleBboxToBake`.
- `apps/app/src/features/segmentation/bbox.test.ts`
- `apps/app/src/features/segmentation/idMap.ts` — `buildIdMap` (pure;
  writes a mask's id into a shared `Uint16Array`).
- `apps/app/src/features/segmentation/idMap.test.ts`
- `apps/app/src/features/segmentation/signature.ts` — `computeSignature`.
- `apps/app/src/features/segmentation/signature.test.ts`
- `apps/app/src/features/segmentation/hitTest.ts` — pointer → mask id.
- `apps/app/src/features/segmentation/hitTest.test.ts`
- `apps/app/src/features/segmentation/decodeCache.ts` — LRU for decoded
  mask `ImageBitmap`s keyed by `png_base64`.
- `apps/app/src/features/segmentation/decodeCache.test.ts`
- `apps/app/src/features/segmentation/compose.ts` — `composeBake`
  orchestrator (uses OffscreenCanvas + pure helpers). No automated
  test; manual verification.
- `apps/app/src/features/segmentation/bakeCache.ts` — `useSegmentBake`
  hook + module-level bake map.
- `apps/app/src/features/segmentation/bakeCache.test.tsx`
- `apps/app/src/features/segmentation/SegmentBakeLayer.tsx` — the
  rendering component.
- `apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx`
- `apps/app/src/features/segmentation/index.ts` — public API barrel.

### Modified files

- `apps/app/src/lib/pb.ts` — add `deleteSegmentationByImageTag`.
- `apps/app/src/Canvas.tsx` — swap overlay block for
  `SegmentBakeLayer`, add `selectedMask` state + Delete keybinding +
  `deleteMask` wiring.
- `apps/app/src/App.css` — add `.segment-bake` and
  `.segment-mask-selected` rules; remove `.segment-mask`, `.segment-bbox`
  (they become dead after Task 17).

---

## Task 1: Scaffold feature folder with types

**Files:**
- Create: `apps/app/src/features/segmentation/types.ts`
- Create: `apps/app/src/features/segmentation/index.ts`

- [ ] **Step 1: Create types file**

Write `apps/app/src/features/segmentation/types.ts`:

```ts
/**
 * One mask's identity within a per-image bake. The tuple (imageId, tag,
 * maskIndex) uniquely identifies a mask in the app's segmentation state.
 */
export type MaskIdentity = {
  imageId: string;
  tag: string;
  maskIndex: number;
};

/**
 * Input to composeBake. Each entry is one already-ready mask ready to
 * be composited. `sourceW`/`sourceH` determine the bake canvas' target
 * resolution (capped by `maxSide`). `decodeCache` is consulted/filled
 * by the composer to avoid re-decoding identical base64 payloads.
 */
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
  decodeCache: Map<string, ImageBitmap>;
};

/**
 * Output of composeBake. `bitmap` is the visible composite;
 * `idMap[y*width + x]` holds the 1-based id of the topmost mask at
 * that pixel, or 0 if empty. `idToMask[id - 1]` maps back to the
 * mask's identity (tag, maskIndex).
 */
export type ComposedBake = {
  bitmap: ImageBitmap;
  idMap: Uint16Array;
  idToMask: ReadonlyArray<{ tag: string; maskIndex: number }>;
  width: number;
  height: number;
};

/** Cached per-image bake entry. */
export type BakeEntry = ComposedBake & {
  signature: string;
};
```

- [ ] **Step 2: Create index barrel**

Write `apps/app/src/features/segmentation/index.ts`:

```ts
export type {
  MaskIdentity,
  ComposeInput,
  ComposedBake,
  BakeEntry,
} from './types';
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/segmentation/types.ts apps/app/src/features/segmentation/index.ts
git commit -m "feat(segmentation): scaffold feature folder with shared types"
```

---

## Task 2: `capDims` pure helper

**Files:**
- Create: `apps/app/src/features/segmentation/dims.ts`
- Test: `apps/app/src/features/segmentation/dims.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/dims.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { capDims } from './dims';

describe('capDims', () => {
  it('returns the input dims when below cap', () => {
    expect(capDims(800, 600, 2048)).toEqual({ w: 800, h: 600 });
  });

  it('scales the longest side down to cap, preserving aspect ratio', () => {
    const { w, h } = capDims(4096, 2048, 2048);
    expect(w).toBe(2048);
    expect(h).toBe(1024);
  });

  it('scales height-dominant images', () => {
    const { w, h } = capDims(1024, 4096, 2048);
    expect(h).toBe(2048);
    expect(w).toBe(512);
  });

  it('rounds to integer pixels', () => {
    const { w, h } = capDims(4097, 2048, 2048);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('returns at least 1 pixel on extreme aspect ratios', () => {
    const { w, h } = capDims(10000, 1, 2048);
    expect(w).toBe(2048);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test dims.test.ts`
Expected: FAIL — cannot find module `./dims`.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/dims.ts`:

```ts
/**
 * Scale `(w, h)` so that the longest side equals at most `maxSide`,
 * preserving aspect ratio. Dimensions are rounded to integers; neither
 * side is ever less than 1.
 */
export function capDims(
  w: number,
  h: number,
  maxSide: number,
): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const k = maxSide / longest;
  return {
    w: Math.max(1, Math.round(w * k)),
    h: Math.max(1, Math.round(h * k)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test dims.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/dims.ts apps/app/src/features/segmentation/dims.test.ts
git commit -m "feat(segmentation): capDims pure helper"
```

---

## Task 3: `scaleBboxToBake` pure helper

**Files:**
- Create: `apps/app/src/features/segmentation/bbox.ts`
- Test: `apps/app/src/features/segmentation/bbox.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/bbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scaleBboxToBake } from './bbox';

describe('scaleBboxToBake', () => {
  it('passes through when mask and bake dims are identical', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 100, 100, 100);
    expect(r).toEqual({ x: 10, y: 20, w: 20, h: 20 });
  });

  it('scales linearly when bake is larger than mask', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 100, 200, 200);
    expect(r).toEqual({ x: 20, y: 40, w: 40, h: 40 });
  });

  it('respects independent x/y scaling', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 200, 200, 400);
    expect(r.x).toBe(20);
    expect(r.y).toBe(40);
    expect(r.w).toBe(40);
    expect(r.h).toBe(40);
  });

  it('returns null when bbox is null', () => {
    expect(scaleBboxToBake(null, 100, 100, 200, 200)).toBeNull();
  });

  it('guarantees at least 1px width and height', () => {
    const r = scaleBboxToBake([0, 0, 0, 0], 100, 100, 100, 100);
    expect(r!.w).toBeGreaterThanOrEqual(1);
    expect(r!.h).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test bbox.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/bbox.ts`:

```ts
/**
 * Rescale a mask-space bbox `[x1, y1, x2, y2]` into the bake canvas'
 * pixel space. Returns null if the input bbox is null. The rectangle
 * is guaranteed at least 1 pixel wide and tall so it remains strokable.
 */
export function scaleBboxToBake(
  bbox: [number, number, number, number] | null,
  maskW: number,
  maskH: number,
  bakeW: number,
  bakeH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!bbox) return null;
  const [x1, y1, x2, y2] = bbox;
  const sx = bakeW / maskW;
  const sy = bakeH / maskH;
  return {
    x: x1 * sx,
    y: y1 * sy,
    w: Math.max(1, (x2 - x1) * sx),
    h: Math.max(1, (y2 - y1) * sy),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test bbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/bbox.ts apps/app/src/features/segmentation/bbox.test.ts
git commit -m "feat(segmentation): scaleBboxToBake pure helper"
```

---

## Task 4: `strokeWidthFor` pure helper

**Files:**
- Create: `apps/app/src/features/segmentation/stroke.ts`
- Test: `apps/app/src/features/segmentation/stroke.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/stroke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { strokeWidthFor } from './stroke';

describe('strokeWidthFor', () => {
  it('returns at least 2 pixels for small bakes', () => {
    expect(strokeWidthFor(256, 256)).toBeGreaterThanOrEqual(2);
    expect(strokeWidthFor(800, 600)).toBeGreaterThanOrEqual(2);
  });

  it('scales up proportionally for large bakes', () => {
    const small = strokeWidthFor(800, 600);
    const big = strokeWidthFor(4096, 3000);
    expect(big).toBeGreaterThan(small);
  });

  it('uses the longer side as the reference', () => {
    expect(strokeWidthFor(2000, 500)).toBe(strokeWidthFor(500, 2000));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test stroke.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/stroke.ts`:

```ts
/**
 * Bake-time bbox stroke width in bake-canvas pixels. Scales with the
 * bake's longest side so annotations stay visually proportional as
 * the source image grows. Final on-screen thickness also rides the
 * view's zoom factor, matching the image's own scaling.
 */
export function strokeWidthFor(bakeW: number, bakeH: number): number {
  const longest = Math.max(bakeW, bakeH);
  return Math.max(2, Math.round(longest / 1000));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test stroke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/stroke.ts apps/app/src/features/segmentation/stroke.test.ts
git commit -m "feat(segmentation): strokeWidthFor pure helper"
```

---

## Task 5: `buildIdMap` pure helper

The id-map write needs to read a rescaled mask's pixels. To keep this
testable without OffscreenCanvas, we accept the mask's raw RGBA pixels
at its native `maskW × maskH` and do the rescale arithmetically per
bake pixel (nearest-neighbour sample). This also keeps allocation
bounded to the already-allocated `idMap`.

**Files:**
- Create: `apps/app/src/features/segmentation/idMap.ts`
- Test: `apps/app/src/features/segmentation/idMap.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/idMap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIdMap } from './idMap';

// Build a maskW × maskH RGBA buffer with all pixels either fully inside
// (alpha 255, rgb 255) or fully outside (alpha 0, rgb 0).
function mkMask(maskW: number, maskH: number, inside: (x: number, y: number) => boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(maskW * maskH * 4);
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      const i = (y * maskW + x) * 4;
      const on = inside(x, y);
      out[i + 0] = on ? 255 : 0;
      out[i + 1] = on ? 255 : 0;
      out[i + 2] = on ? 255 : 0;
      out[i + 3] = on ? 255 : 0;
    }
  }
  return out;
}

describe('buildIdMap', () => {
  it('writes id at bake pixels where the rescaled mask is inside', () => {
    const idMap = new Uint16Array(4 * 4);
    const rgba = mkMask(4, 4, (x, y) => x < 2 && y < 2);
    buildIdMap(idMap, 4, 4, rgba, 4, 4, 7, 128);
    // Top-left 2x2 should be 7.
    expect(idMap[0]).toBe(7);
    expect(idMap[1]).toBe(7);
    expect(idMap[4]).toBe(7);
    expect(idMap[5]).toBe(7);
    // Elsewhere untouched.
    expect(idMap[2]).toBe(0);
    expect(idMap[15]).toBe(0);
  });

  it('rescales the mask to bake dims (nearest-neighbour)', () => {
    const idMap = new Uint16Array(8 * 8);
    // 2x2 mask: top-left inside, rest outside.
    const rgba = mkMask(2, 2, (x, y) => x === 0 && y === 0);
    buildIdMap(idMap, 8, 8, rgba, 2, 2, 3, 128);
    // The single "inside" mask pixel covers the top-left 4x4 of the bake.
    expect(idMap[0]).toBe(3);
    expect(idMap[3]).toBe(3);
    expect(idMap[3 * 8 + 3]).toBe(3);
    // Just outside that quadrant.
    expect(idMap[4]).toBe(0);
    expect(idMap[4 * 8]).toBe(0);
  });

  it('overwrites earlier ids for later masks (topmost wins)', () => {
    const idMap = new Uint16Array(4 * 4);
    const maskA = mkMask(4, 4, () => true);
    buildIdMap(idMap, 4, 4, maskA, 4, 4, 1, 128);
    const maskB = mkMask(4, 4, (x, y) => x < 2 && y < 2);
    buildIdMap(idMap, 4, 4, maskB, 4, 4, 2, 128);
    expect(idMap[0]).toBe(2); // overwritten by mask B
    expect(idMap[3]).toBe(1); // mask A still wins here
  });

  it('respects the luminance threshold', () => {
    const idMap = new Uint16Array(4 * 4);
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    // Pixel (0,0): just above threshold (129). Pixel (1,0): below (127).
    rgba[0] = 129; rgba[1] = 129; rgba[2] = 129; rgba[3] = 255;
    rgba[4] = 127; rgba[5] = 127; rgba[6] = 127; rgba[7] = 255;
    buildIdMap(idMap, 4, 4, rgba, 4, 4, 9, 128);
    expect(idMap[0]).toBe(9);
    expect(idMap[1]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test idMap.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/idMap.ts`:

```ts
/**
 * Write `id` into `idMap[y*bakeW + x]` for every bake pixel that
 * samples (nearest-neighbour) into an "inside" mask pixel. "Inside"
 * is: the mask pixel's luminance (approximated by the max of its R/G/B
 * and its alpha channel) is strictly greater than `threshold`.
 *
 * `maskRgba` is a `Uint8ClampedArray` of size `maskW*maskH*4` in RGBA.
 *
 * Mutates `idMap` in place. Later calls overwrite earlier ids at the
 * same pixel — the composer should call this in the mask drawing
 * order so the topmost mask wins hit-tests.
 */
export function buildIdMap(
  idMap: Uint16Array,
  bakeW: number,
  bakeH: number,
  maskRgba: Uint8ClampedArray,
  maskW: number,
  maskH: number,
  id: number,
  threshold: number,
): void {
  const sx = maskW / bakeW;
  const sy = maskH / bakeH;
  for (let y = 0; y < bakeH; y++) {
    const my = Math.min(maskH - 1, Math.floor(y * sy));
    const rowBakeStart = y * bakeW;
    const rowMaskStart = my * maskW;
    for (let x = 0; x < bakeW; x++) {
      const mx = Math.min(maskW - 1, Math.floor(x * sx));
      const i = (rowMaskStart + mx) * 4;
      const r = maskRgba[i] ?? 0;
      const g = maskRgba[i + 1] ?? 0;
      const b = maskRgba[i + 2] ?? 0;
      const a = maskRgba[i + 3] ?? 0;
      const v = Math.max(r, g, b, a);
      if (v > threshold) idMap[rowBakeStart + x] = id;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test idMap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/idMap.ts apps/app/src/features/segmentation/idMap.test.ts
git commit -m "feat(segmentation): buildIdMap pure helper with nearest-neighbour rescale"
```

---

## Task 6: `computeSignature` pure function

**Files:**
- Create: `apps/app/src/features/segmentation/signature.ts`
- Test: `apps/app/src/features/segmentation/signature.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSignature, type SignatureInput } from './signature';

const mk = (tag: string, index: number, png: string): SignatureInput[number] => ({
  tag,
  maskIndex: index,
  png_base64: png,
});

describe('computeSignature', () => {
  it('is stable for identical inputs', () => {
    const a = [mk('cat', 0, 'AAAABBBB'), mk('cat', 1, 'CCCCDDDD')];
    expect(computeSignature(a)).toBe(computeSignature(a));
  });

  it('changes when a mask is added', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [...a, mk('cat', 1, 'CCCCDDDD')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('changes when a mask payload changes', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('cat', 0, 'AAAACCCC')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('changes when a tag is renamed', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('kitty', 0, 'AAAABBBB')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('is case-insensitive on tag', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('CAT', 0, 'AAAABBBB')];
    expect(computeSignature(a)).toBe(computeSignature(b));
  });

  it('is order-sensitive (preserves render order)', () => {
    const a = [mk('cat', 0, 'AAAABBBB'), mk('dog', 0, 'CCCCDDDD')];
    const b = [mk('dog', 0, 'CCCCDDDD'), mk('cat', 0, 'AAAABBBB')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test signature.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/signature.ts`:

```ts
export type SignatureInput = ReadonlyArray<{
  tag: string;
  maskIndex: number;
  png_base64: string;
}>;

/**
 * Build a deterministic fingerprint of a per-image "ready masks" list.
 * Signature equality implies identical bake output. Render order is
 * significant — later masks paint over earlier ones, so reordering
 * changes the signature.
 *
 * Tag matching is case-insensitive (matches the app's existing tag
 * identity rules — see `submitSegment` in Canvas.tsx). The base64 is
 * sampled by length + head + tail to avoid hashing multi-MB payloads
 * while still catching content changes.
 */
export function computeSignature(masks: SignatureInput): string {
  const parts: string[] = [];
  for (const m of masks) {
    const png = m.png_base64;
    const head = png.slice(0, 16);
    const tail = png.slice(-16);
    parts.push(`${m.tag.toLowerCase()}|${m.maskIndex}|${png.length}|${head}|${tail}`);
  }
  return parts.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/signature.ts apps/app/src/features/segmentation/signature.test.ts
git commit -m "feat(segmentation): computeSignature for bake cache invalidation"
```

---

## Task 7: `hitTestAtPointer` pure helper

**Files:**
- Create: `apps/app/src/features/segmentation/hitTest.ts`
- Test: `apps/app/src/features/segmentation/hitTest.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/hitTest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hitTestAtPointer } from './hitTest';

describe('hitTestAtPointer', () => {
  it('returns the id at the mapped pixel', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;            // (0,0)
    idMap[1] = 7;            // (1,0)
    idMap[4 * 4 - 1] = 9;    // (3,3)
    // Canvas rect is 100x100 at screen origin; bake is 4x4.
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 5, pointerY: 5 }, rect, idMap, 4, 4)).toBe(5);
    expect(hitTestAtPointer({ pointerX: 30, pointerY: 5 }, rect, idMap, 4, 4)).toBe(7);
    expect(hitTestAtPointer({ pointerX: 95, pointerY: 95 }, rect, idMap, 4, 4)).toBe(9);
  });

  it('returns 0 for empty pixels', () => {
    const idMap = new Uint16Array(4 * 4);
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 50, pointerY: 50 }, rect, idMap, 4, 4)).toBe(0);
  });

  it('returns 0 for pointers outside the canvas rect', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;
    const rect = { left: 100, top: 100, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 50, pointerY: 50 }, rect, idMap, 4, 4)).toBe(0);
    expect(hitTestAtPointer({ pointerX: 250, pointerY: 150 }, rect, idMap, 4, 4)).toBe(0);
  });

  it('handles non-zero rect origin (pan offset)', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;
    const rect = { left: 200, top: 300, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 205, pointerY: 305 }, rect, idMap, 4, 4)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test hitTest.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/hitTest.ts`:

```ts
/**
 * Sample the id-map at a pointer location. Returns 0 when the pointer
 * is outside the canvas rect OR maps to an empty pixel.
 *
 * `rect` is the canvas' on-screen bounding rect (from
 * `canvas.getBoundingClientRect()`); it already reflects pan/zoom
 * because the canvas is inside `.ic-content`.
 */
export function hitTestAtPointer(
  pointer: { pointerX: number; pointerY: number },
  rect: { left: number; top: number; width: number; height: number },
  idMap: Uint16Array,
  bakeW: number,
  bakeH: number,
): number {
  const px = pointer.pointerX - rect.left;
  const py = pointer.pointerY - rect.top;
  if (px < 0 || py < 0 || px >= rect.width || py >= rect.height) return 0;
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const cx = Math.min(bakeW - 1, Math.floor((px / rect.width) * bakeW));
  const cy = Math.min(bakeH - 1, Math.floor((py / rect.height) * bakeH));
  return idMap[cy * bakeW + cx] ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test hitTest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/hitTest.ts apps/app/src/features/segmentation/hitTest.test.ts
git commit -m "feat(segmentation): hitTestAtPointer for per-mask pointer routing"
```

---

## Task 8: `decodeCache` LRU for mask bitmaps

**Files:**
- Create: `apps/app/src/features/segmentation/decodeCache.ts`
- Test: `apps/app/src/features/segmentation/decodeCache.test.ts`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/decodeCache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDecodeCache } from './decodeCache';

type FakeBitmap = { id: number; closed: boolean };

let nextId = 1;
function mkBitmap(): FakeBitmap {
  return { id: nextId++, closed: false };
}

beforeEach(() => {
  nextId = 1;
});

describe('createDecodeCache', () => {
  it('decodes once and caches per base64', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache({ capacity: 4, decode });
    const a = await cache.get('AAA');
    const a2 = await cache.get('AAA');
    expect(a).toBe(a2);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used entry and closes its bitmap', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache<FakeBitmap>({
      capacity: 2,
      decode,
      closeBitmap: (b) => {
        b.closed = true;
      },
    });
    const a = await cache.get('A');
    const b = await cache.get('B');
    await cache.get('A'); // touch A so B is LRU
    await cache.get('C'); // should evict B
    expect(b.closed).toBe(true);
    expect(a.closed).toBe(false);
    // 'B' is gone; a new get re-decodes.
    await cache.get('B');
    expect(decode).toHaveBeenCalledTimes(4);
  });

  it('drop() removes a specific entry and closes it', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache<FakeBitmap>({
      capacity: 4,
      decode,
      closeBitmap: (b) => {
        b.closed = true;
      },
    });
    const a = await cache.get('A');
    cache.drop('A');
    expect(a.closed).toBe(true);
    await cache.get('A'); // re-decodes
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test decodeCache.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

Write `apps/app/src/features/segmentation/decodeCache.ts`:

```ts
/**
 * LRU cache for decoded mask bitmaps keyed by base64 payload. Insertion
 * order in a `Map` reflects access order because every touch re-sets
 * the key, which moves it to the end.
 */
export type DecodeCache<B = ImageBitmap> = {
  get: (key: string) => Promise<B>;
  drop: (key: string) => void;
  clear: () => void;
};

export type DecodeCacheOptions<B = ImageBitmap> = {
  capacity: number;
  decode: (key: string) => Promise<B>;
  closeBitmap?: (bmp: B) => void;
};

export function createDecodeCache<B = ImageBitmap>(
  opts: DecodeCacheOptions<B>,
): DecodeCache<B> {
  const { capacity, decode, closeBitmap } = opts;
  const map = new Map<string, B>();

  const close = (bmp: B) => {
    if (closeBitmap) closeBitmap(bmp);
  };

  const touch = (key: string, bmp: B) => {
    map.delete(key);
    map.set(key, bmp);
  };

  const evict = () => {
    while (map.size > capacity) {
      const oldestKey = map.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const bmp = map.get(oldestKey);
      map.delete(oldestKey);
      if (bmp !== undefined) close(bmp);
    }
  };

  return {
    async get(key) {
      const hit = map.get(key);
      if (hit !== undefined) {
        touch(key, hit);
        return hit;
      }
      const bmp = await decode(key);
      map.set(key, bmp);
      evict();
      return bmp;
    },
    drop(key) {
      const bmp = map.get(key);
      if (bmp !== undefined) {
        map.delete(key);
        close(bmp);
      }
    },
    clear() {
      for (const bmp of map.values()) close(bmp);
      map.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netrart/app test decodeCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/segmentation/decodeCache.ts apps/app/src/features/segmentation/decodeCache.test.ts
git commit -m "feat(segmentation): decodeCache — LRU for decoded mask bitmaps"
```

---

## Task 9: `composeBake` orchestrator

No automated test — `OffscreenCanvas` isn't available in the workspace
test envs. Manual verification is covered by the visual-parity
checklist at the end of the plan. The function's shape is constrained
by the already-tested helpers.

**Files:**
- Create: `apps/app/src/features/segmentation/compose.ts`

- [ ] **Step 1: Write the orchestrator**

Write `apps/app/src/features/segmentation/compose.ts`:

```ts
import type { ComposedBake, ComposeInput } from './types';
import { capDims } from './dims';
import { scaleBboxToBake } from './bbox';
import { strokeWidthFor } from './stroke';
import { buildIdMap } from './idMap';

const DEFAULT_MAX_SIDE = 2048;
const ID_THRESHOLD = 128;

type ReadableBitmap = ImageBitmap & { width: number; height: number };

async function decodeBase64ToBitmap(b64: string): Promise<ReadableBitmap> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  return (await createImageBitmap(blob)) as ReadableBitmap;
}

/**
 * Get (or decode and cache) the ImageBitmap for a mask payload.
 */
async function getMaskBitmap(
  cache: Map<string, ImageBitmap>,
  b64: string,
): Promise<ReadableBitmap> {
  const hit = cache.get(b64);
  if (hit) return hit as ReadableBitmap;
  const bmp = await decodeBase64ToBitmap(b64);
  cache.set(b64, bmp);
  return bmp;
}

/**
 * Read the pixels of an ImageBitmap into an RGBA `Uint8ClampedArray` at
 * its native size. Used for the id-map pass.
 */
function readBitmapPixels(bmp: ReadableBitmap): {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const off = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { rgba: data.data, w: bmp.width, h: bmp.height };
}

/**
 * Compose all ready masks for a single image into a single
 * ImageBitmap + id-map. See the design spec for the algorithm.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const scratch = new OffscreenCanvas(w, h);
  const sctx = scratch.getContext('2d');
  if (!sctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const idMap = new Uint16Array(w * h);
  const idToMask: Array<{ tag: string; maskIndex: number }> = [];
  const lineWidth = strokeWidthFor(w, h);

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const id = i + 1;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);

    // Visual: draw the mask rescaled to bake dims → source-in fill with
    // accent → draw the tinted scratch onto the visible canvas.
    sctx.save();
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(bmp, 0, 0, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = m.accent;
    sctx.fillRect(0, 0, w, h);
    sctx.restore();

    vctx.save();
    vctx.globalAlpha = 0.5;
    vctx.drawImage(scratch, 0, 0);
    vctx.restore();

    // Bbox stroke.
    const rect = scaleBboxToBake(m.bbox, m.maskW, m.maskH, w, h);
    if (rect) {
      vctx.save();
      vctx.strokeStyle = m.accent;
      vctx.lineWidth = lineWidth;
      vctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      vctx.restore();
    }

    // Id pass: sample the mask's own pixels (cheaper + matches spec).
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);
    buildIdMap(idMap, w, h, rgba, mw, mh, id, ID_THRESHOLD);
    idToMask.push({ tag: m.tag, maskIndex: m.maskIndex });
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, idMap, idToMask, width: w, height: h };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @netrart/app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/features/segmentation/compose.ts
git commit -m "feat(segmentation): composeBake — OffscreenCanvas orchestrator"
```

---

## Task 10: `useSegmentBake` hook + module-level cache

**Files:**
- Create: `apps/app/src/features/segmentation/bakeCache.ts`
- Test: `apps/app/src/features/segmentation/bakeCache.test.tsx`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/bakeCache.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  __resetBakeCacheForTests,
  __setComposeForTests,
  useSegmentBake,
  type BakeHookInput,
} from './bakeCache';
import type { ComposedBake } from './types';

type FakeBitmap = { id: number; closed: boolean };

function mkFakeBake(idMapFill: number, bitmapId: number): ComposedBake {
  const idMap = new Uint16Array(4);
  idMap.fill(idMapFill);
  const fake = { id: bitmapId, closed: false, close() { this.closed = true; } };
  const bitmap = fake as unknown as ImageBitmap;
  return { bitmap, idMap, idToMask: [], width: 2, height: 2 };
}

const mkInput = (overrides: Partial<BakeHookInput> = {}): BakeHookInput => ({
  imageId: 'img1',
  sourceW: 100,
  sourceH: 100,
  masks: [
    {
      tag: 'cat',
      maskIndex: 0,
      png_base64: 'AAAA',
      maskW: 100,
      maskH: 100,
      bbox: null,
      accent: '#ff0000',
    },
  ],
  ...overrides,
});

beforeEach(() => {
  __resetBakeCacheForTests();
});

describe('useSegmentBake', () => {
  it('invokes compose once on mount and returns the bake', async () => {
    const compose = vi.fn(async () => mkFakeBake(5, 1));
    __setComposeForTests(compose);
    const { result } = renderHook(() => useSegmentBake(mkInput()));
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    expect(result.current.bake!.idMap[0]).toBe(5);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('does not re-compose when the signature is unchanged', async () => {
    const compose = vi.fn(async () => mkFakeBake(5, 1));
    __setComposeForTests(compose);
    const { result, rerender } = renderHook(
      (input: BakeHookInput) => useSegmentBake(input),
      { initialProps: mkInput() },
    );
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    rerender(mkInput()); // identical props
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('re-composes when the signature changes', async () => {
    const compose = vi.fn((): Promise<ComposedBake> =>
      Promise.resolve(mkFakeBake(5, compose.mock.calls.length + 1)),
    );
    __setComposeForTests(compose);
    const { result, rerender } = renderHook(
      (input: BakeHookInput) => useSegmentBake(input),
      { initialProps: mkInput() },
    );
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    const next = mkInput({
      masks: [
        {
          tag: 'cat',
          maskIndex: 0,
          png_base64: 'DIFFERENT',
          maskW: 100,
          maskH: 100,
          bbox: null,
          accent: '#ff0000',
        },
      ],
    });
    rerender(next);
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test bakeCache.test.tsx`
Expected: FAIL — cannot find module `./bakeCache`.

- [ ] **Step 3: Write the hook**

Write `apps/app/src/features/segmentation/bakeCache.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { BakeEntry, ComposedBake, ComposeInput } from './types';
import { composeBake as defaultComposeBake } from './compose';
import { computeSignature } from './signature';
import { createDecodeCache } from './decodeCache';

const DECODE_CAP = 128;
const BAKE_CAP = 32;

// Module-level caches — survive component remounts (e.g., when an image
// scrolls out of view and back).
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

// Insertion-order eviction: oldest entry is evicted first. Good enough
// for v1; swap for a full LRU if it becomes a hot path.
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

// Test seam: swap composeBake. Default is the real one.
let composeFn: (input: ComposeInput) => Promise<ComposedBake> = defaultComposeBake;
export function __setComposeForTests(
  fn: (input: ComposeInput) => Promise<ComposedBake>,
): void {
  composeFn = fn;
}

export function __resetBakeCacheForTests(): void {
  bakeStore.clear();
  composeFn = defaultComposeBake;
}

export type BakeHookInput = {
  imageId: string;
  sourceW: number;
  sourceH: number;
  masks: ComposeInput['masks'];
};

/**
 * Returns the current `BakeEntry` for an image, re-running `composeBake`
 * whenever the input signature changes. The entry is cached at module
 * scope, so scroll-out/scroll-back does not re-bake.
 */
export function useSegmentBake(input: BakeHookInput): {
  bake: BakeEntry | null;
} {
  const [bake, setBake] = useState<BakeEntry | null>(() => {
    return bakeStore.get(input.imageId) ?? null;
  });

  const runIdRef = useRef(0);
  const signature = computeSignature(input.masks);

  useEffect(() => {
    const cached = bakeStore.get(input.imageId);
    if (cached && cached.signature === signature) {
      setBake(cached);
      return;
    }

    const runId = ++runIdRef.current;
    let cancelled = false;

    (async () => {
      const composed = await composeFn({
        sourceW: input.sourceW,
        sourceH: input.sourceH,
        masks: input.masks,
        decodeCache: (decodeCache as unknown as { get: (k: string) => Promise<ImageBitmap> } &
          { drop: (k: string) => void }) as unknown as Map<string, ImageBitmap>,
      });
      if (cancelled || runId !== runIdRef.current) {
        composed.bitmap.close();
        return;
      }
      const entry: BakeEntry = { ...composed, signature };
      const prior = bakeStore.get(input.imageId);
      bakeStore.set(input.imageId, entry);
      if (prior && prior !== entry) prior.bitmap.close();
      evictBakeStore();
      setBake(entry);
    })();

    return () => {
      cancelled = true;
    };
  }, [input.imageId, input.sourceW, input.sourceH, signature, input.masks]);

  return { bake };
}
```

- [ ] **Step 4: Fix the decodeCache type mismatch**

The `ComposeInput.decodeCache` type in `types.ts` is
`Map<string, ImageBitmap>`, but our real cache is a `DecodeCache`. The
hook is adapting to the spec's `Map<string, ImageBitmap>` shape only
because the composer uses `.get`/`.set`. Update the composer to accept
a minimal adapter interface so the real cache satisfies it directly.

Edit `apps/app/src/features/segmentation/types.ts`: change the
`decodeCache` field type of `ComposeInput` from
`Map<string, ImageBitmap>` to:

```ts
  decodeCache: {
    get: (key: string) => Promise<ImageBitmap>;
  };
```

Edit `apps/app/src/features/segmentation/compose.ts` — update
`getMaskBitmap` and its callsite. The new body:

```ts
async function getMaskBitmap(
  cache: ComposeInput['decodeCache'],
  b64: string,
): Promise<ReadableBitmap> {
  const bmp = await cache.get(b64);
  return bmp as ReadableBitmap;
}
```

Remove the old `decodeBase64ToBitmap` helper from `compose.ts` — the
decode now lives in `bakeCache.ts`'s `createDecodeCache` setup.

Update `bakeCache.ts`: replace the `decodeCache` cast in the `composeFn`
call site with plain `decodeCache` (it already exposes `get`).

- [ ] **Step 5: Run tests to verify**

Run: `pnpm --filter @netrart/app test bakeCache.test.tsx`
Expected: PASS.

Run: `pnpm --filter @netrart/app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/segmentation/bakeCache.ts apps/app/src/features/segmentation/bakeCache.test.tsx apps/app/src/features/segmentation/compose.ts apps/app/src/features/segmentation/types.ts
git commit -m "feat(segmentation): useSegmentBake hook with module-level cache"
```

---

## Task 11: `deleteSegmentationByImageTag` in `lib/pb.ts`

**Files:**
- Modify: `apps/app/src/lib/pb.ts`

- [ ] **Step 1: Add the helper**

Add, directly after the existing `deleteAllSegmentationsForImage` in
`apps/app/src/lib/pb.ts`:

```ts
export const deleteSegmentationByImageTag = async (
  imageId: string,
  tag: string,
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, tag);
  if (!match) return;
  await pb.collection('segmentations').delete(match.id);
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @netrart/app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/pb.ts
git commit -m "feat(pb): deleteSegmentationByImageTag for single-tag removal"
```

---

## Task 12: `SegmentBakeLayer` component

**Files:**
- Create: `apps/app/src/features/segmentation/SegmentBakeLayer.tsx`
- Test: `apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

Write `apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentBakeLayer, type SegmentBakeLayerProps } from './SegmentBakeLayer';
import * as bakeCache from './bakeCache';
import type { BakeEntry } from './types';

const mkBake = (overrides: Partial<BakeEntry> = {}): BakeEntry => {
  const idMap = new Uint16Array(2 * 2);
  idMap[0] = 1; // top-left pixel hits mask id 1
  return {
    signature: 'sig',
    bitmap: { width: 2, height: 2, close: () => {} } as unknown as ImageBitmap,
    idMap,
    idToMask: [{ tag: 'cat', maskIndex: 0 }],
    width: 2,
    height: 2,
    ...overrides,
  };
};

const mkProps = (overrides: Partial<SegmentBakeLayerProps> = {}): SegmentBakeLayerProps => ({
  imageId: 'img1',
  worldX: 100,
  worldY: 200,
  worldWidth: 400,
  worldHeight: 400,
  sourceW: 400,
  sourceH: 400,
  masks: [
    {
      tag: 'cat',
      maskIndex: 0,
      png_base64: 'AAAA',
      maskW: 400,
      maskH: 400,
      bbox: null,
      accent: '#ff0000',
    },
  ],
  onMaskSelect: vi.fn(),
  onEmptyPointerDown: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  // Return a stable fake bake synchronously via the hook shim.
  vi.spyOn(bakeCache, 'useSegmentBake').mockReturnValue({ bake: mkBake() });
  // Stub the canvas getContext('bitmaprenderer'); jsdom lacks it.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({ transferFromImageBitmap: () => {} }) as unknown as RenderingContext,
  );
});

describe('SegmentBakeLayer', () => {
  it('renders a canvas at the image world rect', () => {
    const { container } = render(<SegmentBakeLayer {...mkProps()} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.style.left).toBe('100px');
    expect(canvas!.style.top).toBe('200px');
    expect(canvas!.style.width).toBe('400px');
    expect(canvas!.style.height).toBe('400px');
    // Intrinsic bake dims flow to the canvas attrs.
    expect(canvas!.width).toBe(2);
    expect(canvas!.height).toBe(2);
  });

  it('calls onMaskSelect on pointerdown over a mask pixel', () => {
    const onMaskSelect = vi.fn();
    const onEmptyPointerDown = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskSelect, onEmptyPointerDown })} />,
    );
    const canvas = container.querySelector('canvas')!;
    // Stub getBoundingClientRect to align with worldX/Y/size (since jsdom returns 0s).
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    // Pointer near top-left → image-local (0,0) → bake pixel (0,0) → id 1.
    fireEvent.pointerDown(canvas, { clientX: 101, clientY: 201 });
    expect(onMaskSelect).toHaveBeenCalledWith({
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
    });
    expect(onEmptyPointerDown).not.toHaveBeenCalled();
  });

  it('forwards to onEmptyPointerDown when pointer hits an empty pixel', () => {
    const onMaskSelect = vi.fn();
    const onEmptyPointerDown = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskSelect, onEmptyPointerDown })} />,
    );
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    // Pointer near bottom-right → pixel (1,1) in 2x2 idMap → 0.
    fireEvent.pointerDown(canvas, { clientX: 499, clientY: 599 });
    expect(onMaskSelect).not.toHaveBeenCalled();
    expect(onEmptyPointerDown).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netrart/app test SegmentBakeLayer.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the component**

Write `apps/app/src/features/segmentation/SegmentBakeLayer.tsx`:

```tsx
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useSegmentBake, type BakeHookInput } from './bakeCache';
import { hitTestAtPointer } from './hitTest';
import type { MaskIdentity } from './types';

export type SegmentBakeLayerProps = {
  imageId: string;
  // World-coord placement (lives inside .ic-content alongside the <img>).
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
  // Bake input.
  sourceW: number;
  sourceH: number;
  masks: BakeHookInput['masks'];
  // Pointer routing.
  onMaskSelect: (mask: MaskIdentity) => void;
  onEmptyPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
};

export function SegmentBakeLayer({
  imageId,
  worldX,
  worldY,
  worldWidth,
  worldHeight,
  sourceW,
  sourceH,
  masks,
  onMaskSelect,
  onEmptyPointerDown,
}: SegmentBakeLayerProps) {
  const { bake } = useSegmentBake({ imageId, sourceW, sourceH, masks });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Publish the latest bitmap into the canvas (zero-copy).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bake) return;
    if (canvas.width !== bake.width) canvas.width = bake.width;
    if (canvas.height !== bake.height) canvas.height = bake.height;
    const ctx = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
    if (!ctx) return;
    // transferFromImageBitmap neuters the bitmap, but the cache already
    // owns the single instance per entry; consumers of the cache never
    // call transfer elsewhere, so this is safe.
    ctx.transferFromImageBitmap(bake.bitmap);
  }, [bake]);

  if (!bake) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      onEmptyPointerDown(e);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const id = hitTestAtPointer(
      { pointerX: e.clientX, pointerY: e.clientY },
      rect,
      bake.idMap,
      bake.width,
      bake.height,
    );
    if (id === 0) {
      onEmptyPointerDown(e);
      return;
    }
    e.stopPropagation();
    const m = bake.idToMask[id - 1];
    if (!m) {
      onEmptyPointerDown(e);
      return;
    }
    onMaskSelect({ imageId, tag: m.tag, maskIndex: m.maskIndex });
  };

  return (
    <canvas
      ref={canvasRef}
      className="segment-bake"
      width={bake.width}
      height={bake.height}
      style={{
        position: 'absolute',
        left: worldX,
        top: worldY,
        width: worldWidth,
        height: worldHeight,
      }}
      onPointerDown={onPointerDown}
      aria-hidden
    />
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test SegmentBakeLayer.test.tsx`
Expected: PASS.

Run: `pnpm --filter @netrart/app exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Export from barrel**

Edit `apps/app/src/features/segmentation/index.ts` to add:

```ts
export { SegmentBakeLayer } from './SegmentBakeLayer';
export { evictBake, evictDecode } from './bakeCache';
```

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/segmentation/SegmentBakeLayer.tsx apps/app/src/features/segmentation/SegmentBakeLayer.test.tsx apps/app/src/features/segmentation/index.ts
git commit -m "feat(segmentation): SegmentBakeLayer component with per-mask hit routing"
```

---

## Task 13: Wire `SegmentBakeLayer` into Canvas.tsx (read-only)

This task mounts the layer but does not yet implement selection or
deletion. After this task, the visual output matches the current
mask+bbox rendering but is driven by a single canvas per image.

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 1: Import the layer and a helper**

Near the other segmentation imports in `apps/app/src/Canvas.tsx`
(around line 55 alongside `groupSegmentationsByImage`), add:

```ts
import {
  SegmentBakeLayer,
  evictBake,
  evictDecode,
} from './features/segmentation';
```

- [ ] **Step 2: Build the mask list for a given image**

Locate the `visibleMedia` computation (around `Canvas.tsx:720`). After
it (or as a `useMemo` nearby), add a helper that, given a media item,
returns the `masks` input for `SegmentBakeLayer`. Because we only
render the layer for images with at least one *ready* entry, we can
inline this inside the render loop in Step 3. No new top-level
function is needed.

- [ ] **Step 3: Render `SegmentBakeLayer` inside `<InfiniteCanvas>`**

Inside the `<InfiniteCanvas>...</InfiniteCanvas>` block (around
`Canvas.tsx:2082-2113`), after the `paintMedia.map(...)` block, append:

```tsx
{paintMedia
  .filter((m) => m.kind === 'image' && segments[m.id])
  .flatMap((m) => {
    const state = segments[m.id]!;
    const readyEntries = state.entries.filter((e) => e.status === 'ready');
    if (readyEntries.length === 0) return [];
    const masksInput = readyEntries.flatMap((entry) => {
      const { accent } = colorForTag(entry.tag);
      return entry.response.masks.map((mask, idx) => ({
        tag: entry.tag,
        maskIndex: idx,
        png_base64: mask.png_base64,
        maskW: mask.width,
        maskH: mask.height,
        bbox: mask.bbox,
        accent,
      }));
    });
    // source dims are consistent across a single image's ready entries;
    // take the first.
    const first = readyEntries[0]!.response;
    return [
      <SegmentBakeLayer
        key={`bake-${m.id}`}
        imageId={m.id}
        worldX={m.x}
        worldY={m.y}
        worldWidth={m.width}
        worldHeight={m.height}
        sourceW={first.source_width}
        sourceH={first.source_height}
        masks={masksInput}
        onMaskSelect={() => {
          // Wired in Task 14.
        }}
        onEmptyPointerDown={(e) => {
          handleMediaPointerDown(e, m);
        }}
      />,
    ];
  })}
```

- [ ] **Step 4: Remove the old per-mask `.flatMap` overlay block**

Delete the block at `Canvas.tsx:2147-2213` (the `.filter((m) => m.kind
=== 'image' && segments[m.id])` that produces `.segment-mask` and
`.segment-bbox` divs). Leave the loading/error chip block (starts at
~`:2215-2267`) intact.

- [ ] **Step 5: Evict on clear/drop**

In `clearSegment` at `Canvas.tsx:1174`, after
`deleteAllSegmentationsForImage(id).catch(...)`, add:

```ts
evictBake(id);
```

In `dropAsset` (invoked by the deletion paths at
`Canvas.tsx:1351-1380` and `:1411-1443`), after the existing
`lodCache.delete(id)` call, add:

```ts
evictBake(id);
```

- [ ] **Step 6: Manual smoke test**

Run the app: `pnpm dev:app` (in a separate terminal, plus
`pnpm db:start`). Drop in an image, segment it with two tags, observe
the overlays render. Pan + zoom — overlay should stick to the image
exactly as it does in the current build.

Expected: visual parity. Image drag still works on empty pixels (the
bake canvas forwards `onEmptyPointerDown` to `handleMediaPointerDown`).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segmentation): replace per-mask overlays with SegmentBakeLayer"
```

---

## Task 14: `selectedMask` state, Delete keybinding, delete path

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 1: Add the pb import**

In `apps/app/src/Canvas.tsx`, extend the existing pb import (around
`Canvas.tsx:15-31`) to include `deleteSegmentationByImageTag`. Add to
the existing named-import list.

- [ ] **Step 2: Declare `selectedMask` state**

Near the other Canvas useState hooks (search for `const [segments,
setSegments]` around `Canvas.tsx:602`), add:

```ts
import type { MaskIdentity } from './features/segmentation';
// ...
const [selectedMask, setSelectedMask] = useState<MaskIdentity | null>(null);
```

- [ ] **Step 3: Enforce mutual exclusion via effect**

Image selection and mask selection are mutually exclusive. Rather than
hunting every `setSelectedIds` callsite, install a single effect that
clears `selectedMask` whenever the image selection becomes non-empty:

```ts
useEffect(() => {
  if (selectedIds.size > 0) setSelectedMask(null);
}, [selectedIds]);
```

This guarantees correctness everywhere `setSelectedIds` is called,
now and in the future. No other callsite changes needed.

- [ ] **Step 4: Implement `deleteMask`**

Near `clearSegment` at `Canvas.tsx:1174`, add:

```ts
const deleteMask = useCallback(
  (target: MaskIdentity) => {
    const current = segments[target.imageId];
    if (!current) return;
    const nextEntries: typeof current.entries = [];
    let touched = false;
    let tagStillPresent = false;
    for (const entry of current.entries) {
      if (entry.status !== 'ready' || entry.tag.toLowerCase() !== target.tag.toLowerCase()) {
        nextEntries.push(entry);
        continue;
      }
      touched = true;
      const nextMasks = entry.response.masks.filter((_, idx) => idx !== target.maskIndex);
      if (nextMasks.length > 0) {
        nextEntries.push({
          ...entry,
          response: { ...entry.response, masks: nextMasks },
        });
        tagStillPresent = true;
      }
    }
    if (!touched) return;

    setSegments((prev) => {
      const cur = prev[target.imageId];
      if (!cur) return prev;
      if (nextEntries.length === 0) {
        const next = { ...prev };
        delete next[target.imageId];
        return next;
      }
      return { ...prev, [target.imageId]: { entries: nextEntries } };
    });
    setSelectedMask(null);

    // Persist.
    const remainingTagEntry = nextEntries.find(
      (e) => e.status === 'ready' && e.tag.toLowerCase() === target.tag.toLowerCase(),
    );
    if (remainingTagEntry && remainingTagEntry.status === 'ready' && tagStillPresent) {
      const m = mediaRef.current.find((x) => x.id === target.imageId);
      if (m && m.kind === 'image') {
        upsertSegmentation({
          image: target.imageId,
          tag: remainingTagEntry.tag,
          masks: remainingTagEntry.response.masks,
          source_width: remainingTagEntry.response.source_width,
          source_height: remainingTagEntry.response.source_height,
        }).catch((e) => console.warn('[sam3] delete-persist failed', e));
      }
    } else {
      deleteSegmentationByImageTag(target.imageId, target.tag).catch((e) =>
        console.warn('[sam3] delete-tag-persist failed', e),
      );
    }
  },
  [segments],
);
```

- [ ] **Step 5: Install the Delete keybinding**

Near the existing keydown handlers in Canvas.tsx (search for
`keydown`), add an effect:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!selectedMask) return;
    // Don't hijack text inputs.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    e.preventDefault();
    deleteMask(selectedMask);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [selectedMask, deleteMask]);
```

- [ ] **Step 6: Wire `onMaskSelect` into the bake layer**

In the `<SegmentBakeLayer ... />` usage from Task 13, replace the
empty `onMaskSelect` with:

```tsx
onMaskSelect={(id) => {
  setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  setLastSelectedId(null);
  setSelectedMask(id);
}}
```

- [ ] **Step 7: Render the selection ring**

Immediately after the `<SegmentBakeLayer ... />` block inside
`<InfiniteCanvas>`, add the selection-ring render (inside
`.ic-content`, world coords):

```tsx
{selectedMask && (() => {
  const m = paintMedia.find((x) => x.id === selectedMask.imageId);
  if (!m || m.kind !== 'image') return null;
  const state = segments[selectedMask.imageId];
  if (!state) return null;
  const entry = state.entries.find(
    (e) => e.status === 'ready' && e.tag.toLowerCase() === selectedMask.tag.toLowerCase(),
  );
  if (!entry || entry.status !== 'ready') return null;
  const mask = entry.response.masks[selectedMask.maskIndex];
  if (!mask || !mask.bbox) return null;
  const [x1, y1, x2, y2] = mask.bbox;
  const fx = m.width / mask.width;
  const fy = m.height / mask.height;
  const { accent } = colorForTag(entry.tag);
  return (
    <div
      key={`selected-${selectedMask.imageId}-${selectedMask.tag}-${selectedMask.maskIndex}`}
      className="segment-mask-selected"
      style={{
        left: m.x + x1 * fx,
        top: m.y + y1 * fy,
        width: Math.max(1, (x2 - x1) * fx),
        height: Math.max(1, (y2 - y1) * fy),
        borderColor: accent,
        boxShadow: `0 0 0 2px ${accent}33`,
      }}
      aria-hidden
    />
  );
})()}
```

- [ ] **Step 8: Manual verification**

Run the app. Segment an image with a tag that yields ≥ 2 masks (or two
tags). Click one mask → ring appears. Press Delete → that mask
vanishes. Reload the app → the deletion persists.

Click an empty pixel on a segmented image → image selection still
behaves normally; selection ring disappears.

Click a mask, then click another image → selection ring is cleared
(image selection replaces it).

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(segmentation): interactive mask selection + delete"
```

---

## Task 15: CSS for `.segment-bake` and `.segment-mask-selected`

**Files:**
- Modify: `apps/app/src/App.css`

- [ ] **Step 1: Add new rules**

In `apps/app/src/App.css`, near the existing `.segment-mask` block
(around line 628), add above or below it:

```css
/* Baked per-image segmentation overlay. Lives inside .ic-content and
   rides pan/zoom via the container transform; intrinsic pixel buffer
   is the bake resolution, CSS stretches it to the image's world rect. */
.segment-bake {
  position: absolute;
  z-index: 12;
  pointer-events: auto;
  /* Preserve crisp mask edges when the container scales up. */
  image-rendering: pixelated;
}

/* Selection ring around a single selected mask's bbox. World-coord
   sibling of the image and the bake canvas; scales with the container
   transform. */
.segment-mask-selected {
  position: absolute;
  z-index: 14;
  pointer-events: none;
  border: 2px solid;
  border-radius: 2px;
}
```

- [ ] **Step 2: Remove the now-dead `.segment-mask` and `.segment-bbox` rules**

Delete the `.segment-mask { ... }` and `.segment-bbox { ... }` blocks
from `apps/app/src/App.css` (they were at lines 629-646 in the
pre-change file). Leave `.segment-overlay*` and `.segment-chip*` rules
alone — they drive the loading/error chips.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @netra/app test --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/App.css
git commit -m "style(segmentation): replace per-mask CSS with bake + selection ring"
```

---

## Task 16: Manual verification + ship

This task is a checklist; if any item fails, file a follow-up bug or
revisit the prior tasks rather than papering over it.

- [ ] **Step 1: Performance check**

With `pnpm dev:app` running, place an image that segments into ≥ 10
masks (e.g., a group photo prompted for "person"). Open devtools
Performance tab, record a 3-second pan + zoom session.

Expected: No `.segment-mask` or `.segment-bbox` layout work. Main
thread largely idle outside the initial bake. The previous build had
dozens of style-recalc entries per frame; the new build should show
one or none.

- [ ] **Step 2: Visual parity**

Segment the same image with the same tag(s) in the previous build and
the new one. Side-by-side: mask tint color, opacity, bbox color, and
placement match within a couple of pixels (bake is nearest-neighbour,
so slight aliasing differences at extreme zoom-in are expected and
acceptable).

- [ ] **Step 3: Interactive select + delete**

- Click a mask — accent ring appears on its bbox.
- Click another mask — ring jumps.
- Press Delete — mask vanishes, ring clears.
- Reload the app — the deleted mask does not return.
- Click empty area of a segmented image — image drag works.
- Click a non-segmented image — segmentation ring clears if present.

- [ ] **Step 4: Overlapping masks**

Segment the same image with two prompts whose masks overlap (e.g.,
"person" and "face"). Click in the overlap region — the topmost (last
drawn) mask should be selected. Delete it — the lower mask remains
visible and selectable.

- [ ] **Step 5: Chip overlays still work**

Submit a new tag on a segmented image — the loading chip should
animate during the submit and disappear when the mask arrives. Trigger
an intentional error (kill PB mid-submit) — error chip should appear.

- [ ] **Step 6: Cleanup commit (if any)**

If any test-only code or debug logs slipped through, clean them up and
commit:

```bash
git add -u
git commit -m "chore(segmentation): post-verification cleanup"
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat: bake segmentation overlays per image" --body "$(cat <<'EOF'
## Summary

Replaces the per-mask DOM overlays with a single composited canvas per
segmented image. Pan/zoom no longer re-styles N overlays per frame.

Adds interactive per-mask selection and delete, with pixel-accurate
hit-testing via a parallel id-map.

See `docs/superpowers/specs/2026-04-24-overlay-baking-design.md`.

## Test plan

- [x] Unit tests for pure helpers pass
- [x] Pan/zoom on 10+ mask image shows no per-overlay layout work
- [x] Click-to-select, Delete-to-remove works and persists
- [x] Overlapping masks resolve to topmost on click
- [x] Loading + error chips still animate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
