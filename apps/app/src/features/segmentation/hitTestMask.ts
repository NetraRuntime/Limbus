import type { HitMask, MaskIdentity } from './types';

/**
 * Even-odd point-in-polygon test across all rings of a mask. A point
 * is "inside" the mask when it crosses an odd number of ring edges on
 * a horizontal ray cast to +∞. This matches `canvas.fill(path, 'evenodd')`
 * behaviour used at paint time in compose.ts, so donut masks (outer
 * ring + inner hole) hit-test correctly.
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
 * `rect` is the canvas' on-screen bounding rect (from
 * `canvas.getBoundingClientRect()`); it already reflects pan/zoom
 * because the canvas is inside `.ic-content`. Pointer coordinates are
 * mapped into bake-pixel space by the rect → (bakeW, bakeH) ratio.
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
