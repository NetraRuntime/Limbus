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
