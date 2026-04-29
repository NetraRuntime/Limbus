import {
  BboxOverlayLayer,
  type BboxOverlayRect,
  type MaskIdentity,
} from '../../../segmentation';
import { colorForTag } from '../../../../components/savedTags';
import type { View } from '../../../../InfiniteCanvas';
import type { CanvasMedia, SegmentState } from '../../lib';

type Props = {
  paintMedia: CanvasMedia[];
  view: View;
  segments: Record<string, SegmentState>;
  selectedMask: MaskIdentity | null;
  hoveredMask: MaskIdentity | null;
  activeId: string | null;
  soloTag: string | null;
  viewport: { w: number; h: number };
};

export function BboxOverlayContainer({
  paintMedia,
  view,
  segments,
  selectedMask,
  hoveredMask,
  activeId,
  soloTag,
  viewport,
}: Props) {
  const soloLower = soloTag ? soloTag.toLowerCase() : null;
  const rects: BboxOverlayRect[] = [];

  for (const m of paintMedia) {
    if (m.kind !== 'image') continue;
    const state = segments[m.id];
    if (!state) continue;
    for (const entry of state.entries) {
      if (entry.status !== 'ready') continue;
      const tagLower = entry.tag.toLowerCase();
      // Solo only applies to the active image; other images render all
      // their bboxes as usual.
      if (soloLower && m.id === activeId && tagLower !== soloLower) continue;
      const { accent } = colorForTag(entry.tag);
      const entryId = entry.kind === 'box' ? entry.boxId : undefined;
      for (let i = 0; i < entry.response.masks.length; i += 1) {
        const mask = entry.response.masks[i];
        if (!mask || !mask.bbox) continue;
        // Two box entries can share a display tag; match by entryId
        // too so selected/hovered chrome lands on the intended entry.
        const isSel =
          selectedMask &&
          selectedMask.imageId === m.id &&
          selectedMask.tag.toLowerCase() === tagLower &&
          selectedMask.maskIndex === i &&
          selectedMask.entryId === entryId;
        const isHov =
          hoveredMask &&
          hoveredMask.imageId === m.id &&
          hoveredMask.tag.toLowerCase() === tagLower &&
          hoveredMask.maskIndex === i &&
          hoveredMask.entryId === entryId;
        if (isSel || isHov) continue;
        const [x1, y1, x2, y2] = mask.bbox;
        const fx = m.width / mask.width;
        const fy = m.height / mask.height;
        // Include boxId (when present) in the key so two box entries
        // sharing a tag don't collide on React's key check.
        rects.push({
          key: `${m.id}-${entry.tag}-${entry.kind === 'box' ? entry.boxId ?? '' : ''}-${i}`,
          left: (m.x + x1 * fx) * view.scale + view.x,
          top: (m.y + y1 * fy) * view.scale + view.y,
          width: Math.max(1, (x2 - x1) * fx) * view.scale,
          height: Math.max(1, (y2 - y1) * fy) * view.scale,
          accent,
        });
      }
    }
  }

  return (
    <BboxOverlayLayer
      viewportWidth={viewport.w}
      viewportHeight={viewport.h}
      rects={rects}
    />
  );
}
