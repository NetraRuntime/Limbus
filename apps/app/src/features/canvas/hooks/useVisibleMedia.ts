import { useMemo } from 'react';
import {
  computeLabelPlacements,
  type LabelPlacement,
} from '../../../lib/labelPlacement';
import { labelOuterWidth } from '../../../lib/labelMetrics';
import type { View } from '../../../InfiniteCanvas';
import {
  CULL_BUFFER_FACTOR,
  type CanvasMedia,
} from '../lib';

type Args = {
  media: CanvasMedia[];
  stackOrder: string[];
  view: View;
  viewport: { w: number; h: number };
  selectedIds: Set<string>;
  hoverId: string | null;
  /**
   * Optional accessor that returns ids currently being dragged. They're
   * always kept in `visibleMedia` so the cull buffer doesn't pop them
   * mid-drag. Pass `null` when no drag is active.
   */
  getDraggingIds?: () => Iterable<string> | null;
};

export type VisibleMedia = {
  visibleMedia: CanvasMedia[];
  paintMedia: CanvasMedia[];
  labelPlacements: Map<string, LabelPlacement>;
};

/**
 * Visible/paint-ordered slices of media plus per-item label placements.
 *
 * - visibleMedia: viewport-culled list (selected/hovered/dragging items
 *   always pass so they don't disappear at the edge).
 * - paintMedia: visibleMedia sorted by stackOrder, with un-ranked items
 *   sinking under ranked ones (tie-break by their media-array index).
 * - labelPlacements: per-item corner picked so each filename badge avoids
 *   strictly-higher-stacked neighbors.
 */
export function useVisibleMedia({
  media,
  stackOrder,
  view,
  viewport,
  selectedIds,
  hoverId,
  getDraggingIds,
}: Args): VisibleMedia {
  const visibleMedia = useMemo(() => {
    if (!viewport.w || !viewport.h || !media.length) return media;
    const padX = viewport.w * CULL_BUFFER_FACTOR;
    const padY = viewport.h * CULL_BUFFER_FACTOR;
    const minX = (-view.x - padX) / view.scale;
    const minY = (-view.y - padY) / view.scale;
    const maxX = (viewport.w - view.x + padX) / view.scale;
    const maxY = (viewport.h - view.y + padY) / view.scale;
    const draggingIds = getDraggingIds ? new Set(getDraggingIds() ?? []) : null;
    return media.filter((m) => {
      if (selectedIds.has(m.id) || m.id === hoverId) return true;
      if (draggingIds && draggingIds.has(m.id)) return true;
      return (
        m.x + m.width >= minX &&
        m.y + m.height >= minY &&
        m.x <= maxX &&
        m.y <= maxY
      );
    });
    // dragRef is stable; selectedIds/hoverId reads provide observable
    // inputs to the cull predicate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, view, viewport, selectedIds, hoverId]);

  const paintMedia = useMemo(() => {
    if (visibleMedia.length <= 1) return visibleMedia;
    const rank = new Map<string, number>();
    stackOrder.forEach((id, i) => rank.set(id, i));
    const fallback = new Map<string, number>();
    media.forEach((m, i) => fallback.set(m.id, i));
    const items = [...visibleMedia];
    items.sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return 1;
      if (rb !== undefined) return -1;
      return (fallback.get(a.id) ?? 0) - (fallback.get(b.id) ?? 0);
    });
    return items;
  }, [visibleMedia, stackOrder, media]);

  const labelPlacements = useMemo(() => {
    const rankMap = new Map<string, number>();
    const baseOffset = media.length;
    media.forEach((m, i) => rankMap.set(m.id, i));
    stackOrder.forEach((id, i) => rankMap.set(id, baseOffset + i));
    return computeLabelPlacements({
      items: paintMedia,
      rank: (id) => rankMap.get(id) ?? -1,
      scale: view.scale,
      labelWidth: labelOuterWidth,
    });
  }, [paintMedia, media, stackOrder, view.scale]);

  return { visibleMedia, paintMedia, labelPlacements };
}
