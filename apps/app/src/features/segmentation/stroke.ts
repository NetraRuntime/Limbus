export function strokeWidthFor(bakeW: number, bakeH: number): number {
  const longest = Math.max(bakeW, bakeH);
  return Math.max(2, Math.round(longest / 1000));
}
