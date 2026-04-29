import type { TagListEntry } from '../../components/MediaTagList';

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
    if (!e || e.status !== 'ready') continue;
    if (e.tag.toLowerCase() === key) currentReadyPos = readyIdxs.length;
    readyIdxs.push(i);
  }
  if (currentReadyPos === -1) return null;
  const targetPos = dir === 'next' ? currentReadyPos + 1 : currentReadyPos - 1;
  if (targetPos < 0 || targetPos >= readyIdxs.length) return null;
  const entryIdx = readyIdxs[targetPos];
  if (entryIdx === undefined) return null;
  return entries[entryIdx]?.tag ?? null;
}
