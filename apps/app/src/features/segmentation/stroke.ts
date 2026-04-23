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
