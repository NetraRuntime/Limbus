import { memo, useCallback, useMemo } from 'react';
import {
  SegmentBakeLayer,
  type MaskIdentity,
} from '../../segmentation';
import { colorForTag } from '../../../components/savedTags';
import type { CanvasMedia, MediaPointerEvent, SegmentState } from '../lib';

// Stabilizes refs so SegmentBakeLayer's React.memo bails on pan/zoom (hot path: rAF re-renders).
export type BakeForImageProps = {
  m: CanvasMedia;
  state: SegmentState;
  /** When set, only masks for this tag are baked; null for non-active images. */
  soloTag: string | null;
  onMaskSelect: (id: { imageId: string; tag: string; maskIndex: number }) => void;
  onMaskHover: (id: MaskIdentity | null) => void;
  onEmptyPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};

export const BakeForImage = memo(function BakeForImage({
  m,
  state,
  soloTag,
  onMaskSelect,
  onMaskHover,
  onEmptyPointerDown,
  onEnter,
  onLeave,
  onPointerMove,
  onPointerUp,
}: BakeForImageProps) {
  const { masksInput, first } = useMemo(() => {
    const readyEntries = state.entries.filter(
      (e): e is Extract<typeof e, { status: 'ready' }> => e.status === 'ready',
    );
    if (readyEntries.length === 0) {
      return { masksInput: null, first: null };
    }
    const soloLower = soloTag ? soloTag.toLowerCase() : null;
    const visibleEntries = soloLower
      ? readyEntries.filter((e) => e.tag.toLowerCase() === soloLower)
      : readyEntries;
    if (visibleEntries.length === 0) {
      return { masksInput: null, first: readyEntries[0]!.response };
    }
    const built = visibleEntries.flatMap((entry) => {
      const { accent } = colorForTag(entry.tag);
      const entryId = entry.kind === 'box' ? entry.boxId : undefined;
      return entry.response.masks.map((mask, idx) => ({
        tag: entry.tag,
        maskIndex: idx,
        entryId,
        png_base64: mask.png_base64,
        maskW: mask.width,
        maskH: mask.height,
        bbox: mask.bbox,
        accent,
      }));
    });
    return { masksInput: built, first: visibleEntries[0]!.response };
  }, [state, soloTag]);

  const handleEmpty = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      onEmptyPointerDown(e, m);
    },
    [m, onEmptyPointerDown],
  );
  const handleEnter = useCallback(() => onEnter(m.id), [m.id, onEnter]);

  if (!masksInput || !first) return null;

  return (
    <SegmentBakeLayer
      imageId={m.id}
      worldX={m.x}
      worldY={m.y}
      worldWidth={m.width}
      worldHeight={m.height}
      sourceW={first.source_width}
      sourceH={first.source_height}
      masks={masksInput}
      onMaskSelect={onMaskSelect}
      onMaskHover={onMaskHover}
      onEmptyPointerDown={handleEmpty}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
});
