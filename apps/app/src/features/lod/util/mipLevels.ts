import { LEVEL_CANDIDATES, MIN_LEVEL_PX } from '../types';

export function computeMipLevels(longestSidePx: number): number[] {
  if (longestSidePx < MIN_LEVEL_PX) return [];
  return LEVEL_CANDIDATES.filter((px) => px <= longestSidePx);
}
