// Keep LABEL_FONT and LABEL_LETTER_SPACING in lockstep with the
// .media-label CSS rule — pretext cannot see CSS.

import { prepareWithSegments, measureNaturalWidth } from '@chenglou/pretext';

export const LABEL_FONT =
  '500 9px "Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const LABEL_LETTER_SPACING = -0.1;

const PADDING_BORDER_PX = 16;

export const LABEL_MAX_OUTER_PX = 320;

const widthCache = new Map<string, number>();

export function labelOuterWidth(name: string): number {
  const hit = widthCache.get(name);
  if (hit !== undefined) return hit;
  const prepared = prepareWithSegments(name, LABEL_FONT, {
    letterSpacing: LABEL_LETTER_SPACING,
  });
  const text = measureNaturalWidth(prepared);
  const outer = Math.min(
    LABEL_MAX_OUTER_PX,
    Math.ceil(text) + PADDING_BORDER_PX,
  );
  widthCache.set(name, outer);
  return outer;
}
