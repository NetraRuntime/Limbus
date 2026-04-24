import type { TagListEntry } from '../../components/MediaTagList';

/**
 * Compute the next solo tag when the user presses Arrow Up / Arrow Down in
 * the tag list. Skips non-ready entries (they can't be solo'd today).
 * Returns null when the move is clamped at an end, the current tag is not
 * present, or the list is empty.
 *
 * Matches `current` case-insensitively and returns the original casing from
 * `entries` so the caller can persist it as-is.
 */
export function nextSoloTag(
  current: string,
  entries: readonly TagListEntry[],
  dir: 'prev' | 'next',
): string | null {
  const key = current.toLowerCase();
  const readyIdxs: number[] = [];
  let currentReadyPos = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.status !== 'ready') continue;
    if (e.tag.toLowerCase() === key) currentReadyPos = readyIdxs.length;
    readyIdxs.push(i);
  }
  if (currentReadyPos === -1) return null;
  const targetPos = dir === 'next' ? currentReadyPos + 1 : currentReadyPos - 1;
  if (targetPos < 0 || targetPos >= readyIdxs.length) return null;
  return entries[readyIdxs[targetPos]].tag;
}
