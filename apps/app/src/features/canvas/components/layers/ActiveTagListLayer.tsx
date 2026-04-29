import { MediaTagList } from '../../../../components/MediaTagList';
import type { CanvasMedia, SegmentState, TagSegment } from '../../lib';

type ActiveRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  activeMedia: CanvasMedia | null;
  activeRect: ActiveRect | null;
  segments: Record<string, SegmentState>;
  soloTag: string | null;
  setSoloTag: React.Dispatch<React.SetStateAction<string | null>>;
  onRemoveTag: (imageId: string, tag: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

// Dedup by tag: two box entries can share a label ("cat"/"cat"); the chip
// list only shows one per label. Prefer a 'ready' entry over loading/error
// so the final state wins visually.
const dedupEntries = (entries: TagSegment[]) => {
  const byTag = new Map<string, { tag: string; status: TagSegment['status'] }>();
  for (const e of entries) {
    const key = e.tag.toLowerCase();
    const prev = byTag.get(key);
    if (!prev || (prev.status !== 'ready' && e.status === 'ready')) {
      byTag.set(key, { tag: e.tag, status: e.status });
    }
  }
  return Array.from(byTag.values());
};

export function ActiveTagListLayer({
  activeMedia,
  activeRect,
  segments,
  soloTag,
  setSoloTag,
  onRemoveTag,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  if (!activeMedia || !activeRect) return null;
  if (activeMedia.kind !== 'image') return null;
  const entries = segments[activeMedia.id]?.entries ?? [];
  if (entries.length === 0) return null;

  return (
    <MediaTagList
      rect={activeRect}
      entries={dedupEntries(entries)}
      onRemove={(tag) => onRemoveTag(activeMedia.id, tag)}
      onSelect={(tag) => {
        // Toggle: re-clicking the current solo tag clears the filter.
        setSoloTag((prev) =>
          prev && prev.toLowerCase() === tag.toLowerCase() ? null : tag,
        );
      }}
      soloTag={soloTag}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}
