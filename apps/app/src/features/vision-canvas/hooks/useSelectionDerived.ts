import { useEffect, useMemo, type RefObject } from 'react';
import type { CanvasMedia, MarqueeState } from '../lib';
import type { MarqueeRect } from './useMarqueeGesture';

type Args = {
  media: CanvasMedia[];
  selectedIds: Set<string>;
  lastSelectedId: string | null;
  hoverId: string | null;
  marqueeRect: MarqueeRect;
  marqueeRef: RefObject<MarqueeState | null>;
  setSoloTag: (tag: string | null) => void;
  setMultiHighlightInput: (next: string[]) => void;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SelectionDerived = {
  activeSet: Set<string>;
  activeId: string | null;
  activeMedia: CanvasMedia | null;
  selectionBBox: Bounds | null;
  multiSelectKey: string;
};

/**
 * Selection-derived view state. Folds in the marquee's live "inside" set
 * so per-frame highlighting follows the rubberband, picks the single
 * "active" item that drives the floating UI, and computes the bounding
 * box for multi-select chrome. Also resets solo-tag and the multi-select
 * tag input when those upstream identities change.
 */
export function useSelectionDerived({
  media,
  selectedIds,
  lastSelectedId,
  hoverId,
  marqueeRect,
  marqueeRef,
  setSoloTag,
  setMultiHighlightInput,
}: Args): SelectionDerived {
  const marqueeInside = useMemo(() => {
    if (!marqueeRect) return null;
    const inside = new Set<string>();
    for (const m of media) {
      if (
        m.x + m.width >= marqueeRect.minX &&
        m.x <= marqueeRect.maxX &&
        m.y + m.height >= marqueeRect.minY &&
        m.y <= marqueeRect.maxY
      ) {
        inside.add(m.id);
      }
    }
    return inside;
  }, [marqueeRect, media]);

  const activeSet = useMemo<Set<string>>(() => {
    if (marqueeInside && marqueeRef.current) {
      const s = new Set(
        marqueeRef.current.additive ? marqueeRef.current.baseSet : [],
      );
      for (const id of marqueeInside) s.add(id);
      return s;
    }
    if (selectedIds.size > 0) return selectedIds;
    if (hoverId) return new Set([hoverId]);
    return new Set();
    // marqueeRef is stable; marqueeInside is the observable reflection.
  }, [selectedIds, hoverId, marqueeInside, marqueeRef]);

  const activeId = useMemo<string | null>(() => {
    if (marqueeRef.current) return null;
    if (selectedIds.size === 1)
      return lastSelectedId ?? Array.from(selectedIds)[0] ?? null;
    if (selectedIds.size === 0) return hoverId;
    return null;
  }, [selectedIds, hoverId, lastSelectedId, marqueeRef]);

  const activeMedia = useMemo(
    () => (activeId ? (media.find((m) => m.id === activeId) ?? null) : null),
    [activeId, media],
  );

  // Solo-tag is scoped to the currently active image. When the active
  // image changes, drop the filter so the next image starts unfiltered.
  useEffect(() => {
    setSoloTag(null);
    // setSoloTag identity is stable from useState/useSegmentationState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMedia?.id]);

  const selectionBBox = useMemo<Bounds | null>(() => {
    if (selectedIds.size < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of media) {
      if (!selectedIds.has(m.id)) continue;
      if (m.x < minX) minX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.x + m.width > maxX) maxX = m.x + m.width;
      if (m.y + m.height > maxY) maxY = m.y + m.height;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }, [selectedIds, media]);

  const multiSelectKey = useMemo(() => {
    if (selectedIds.size < 2) return '';
    return Array.from(selectedIds).sort().join(' ');
  }, [selectedIds]);

  useEffect(() => {
    setMultiHighlightInput([]);
    // setMultiHighlightInput identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiSelectKey]);

  return { activeSet, activeId, activeMedia, selectionBBox, multiSelectKey };
}
