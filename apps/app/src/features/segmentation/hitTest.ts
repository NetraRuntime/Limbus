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
