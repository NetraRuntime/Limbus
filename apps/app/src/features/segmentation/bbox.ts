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
