/**
 * Write `id` into `idMap[y*bakeW + x]` for every bake pixel that
 * samples (nearest-neighbour) into an "inside" mask pixel. "Inside"
 * is: the mask pixel's luminance (approximated by the max of its R/G/B)
 * is strictly greater than `threshold`.
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
      const v = Math.max(r, g, b);
      if (v > threshold) idMap[rowBakeStart + x] = id;
    }
  }
}
