export const MIN_LEVEL_PX = 64;
export const MAX_LEVEL_PX = 1024;
export const LEVEL_CANDIDATES = [64, 128, 256, 512, 1024] as const;
export const UPGRADE_HYSTERESIS = 1.25;
export const DEFAULT_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;
export const CACHE_DRAIN_TO_FRACTION = 0.9;
export const WEBP_QUALITY = 0.8;

export type AssetKind = 'image' | 'video';

export type PickedLevel = number | 'full';

export type SourceDims = {
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
};

export type LodEntry = {
  assetId: string;
  levelPx: number;
  kind: AssetKind;
  blob: Blob;
  bytes: number;
  lastAccessed: number;
};

export type LodSource = {
  /** Blob URL for the chosen mip level, or the full-res URL when no cached level fits. */
  lodSrc: string;
  /** True when `lodSrc` is the full-res fallback (no cached level available). */
  isFallback: boolean;
  /** Videos only: whether to render the live <video> (true) or the poster <img> (false). */
  playVideo: boolean;
};
