import { LEVEL_CANDIDATES, MIN_LEVEL_PX } from '../types';

/** Ascending set of mip level pixel sizes (longest-side) that fit inside
 *  the given source. A source below MIN_LEVEL_PX yields an empty pyramid,
 *  meaning LoD is skipped for that asset.
 */
export function computeMipLevels(longestSidePx: number): number[] {
  if (longestSidePx < MIN_LEVEL_PX) return [];
  return LEVEL_CANDIDATES.filter((px) => px <= longestSidePx);
}
