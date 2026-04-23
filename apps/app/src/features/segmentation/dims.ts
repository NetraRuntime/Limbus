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
