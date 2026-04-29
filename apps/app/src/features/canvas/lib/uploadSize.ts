import { DEFAULT_UPLOAD_LONGEST_SIDE } from './constants';

type Dims = { width: number; height: number };

export const medianLongestSide = (items: readonly Dims[]): number => {
  const longs: number[] = [];
  for (const m of items) {
    const s = Math.max(m.width, m.height);
    if (Number.isFinite(s) && s > 0) longs.push(s);
  }
  if (longs.length === 0) return 0;
  longs.sort((a, b) => a - b);
  const mid = longs.length >> 1;
  return longs.length % 2 === 0
    ? (longs[mid - 1]! + longs[mid]!) / 2
    : longs[mid]!;
};

export const normalizeUploadSize = (
  dims: Dims,
  reference: readonly Dims[],
): Dims => {
  if (dims.width <= 0 || dims.height <= 0) return dims;
  const target =
    reference.length === 0
      ? DEFAULT_UPLOAD_LONGEST_SIDE
      : medianLongestSide(reference);
  if (!target || !Number.isFinite(target) || target <= 0) return dims;
  const longest = Math.max(dims.width, dims.height);
  if (longest <= 0) return dims;
  const k = target / longest;
  return {
    width: Math.max(1, Math.round(dims.width * k)),
    height: Math.max(1, Math.round(dims.height * k)),
  };
};
