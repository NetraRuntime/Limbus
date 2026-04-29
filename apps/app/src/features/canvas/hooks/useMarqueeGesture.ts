import { useCallback, useRef, useState, type RefObject } from 'react';
import type {
  BackgroundPointerDown,
  View,
} from '../../../InfiniteCanvas';
import {
  DRAG_THRESHOLD_PX,
  subscribeWindowDrag,
  type CanvasMedia,
  type MarqueeState,
} from '../lib';

export type MarqueeRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null;

type Args = {
  viewRef: RefObject<View>;
  mediaRef: RefObject<CanvasMedia[]>;
  selectedIdsRef: RefObject<Set<string>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  clearSelectionRef: RefObject<() => void>;
};

export type MarqueeGesture = {
  marqueeRect: MarqueeRect;
  marqueeRef: RefObject<MarqueeState | null>;
  handleBackgroundPointerDown: (p: BackgroundPointerDown) => void;
};

export function useMarqueeGesture({
  viewRef,
  mediaRef,
  selectedIdsRef,
  setSelectedIds,
  setLastSelectedId,
  clearSelectionRef,
}: Args): MarqueeGesture {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  const handleBackgroundPointerDown = useCallback(
    (p: BackgroundPointerDown) => {
      marqueeRef.current = {
        pointerId: p.pointerId,
        startClientX: p.clientX,
        startClientY: p.clientY,
        startWorldX: p.worldX,
        startWorldY: p.worldY,
        baseSet: new Set(selectedIdsRef.current ?? []),
        additive: p.shiftKey,
        moved: false,
      };

      const onMove = (e: PointerEvent) => {
        const m = marqueeRef.current;
        if (!m || e.pointerId !== m.pointerId) return;
        const dxScreen = e.clientX - m.startClientX;
        const dyScreen = e.clientY - m.startClientY;
        if (!m.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) {
          return;
        }
        m.moved = true;
        // Container is position:fixed;inset:0 so client coords map directly.
        const v = viewRef.current!;
        const curWorldX = (e.clientX - v.x) / v.scale;
        const curWorldY = (e.clientY - v.y) / v.scale;
        setMarqueeRect({
          minX: Math.min(m.startWorldX, curWorldX),
          minY: Math.min(m.startWorldY, curWorldY),
          maxX: Math.max(m.startWorldX, curWorldX),
          maxY: Math.max(m.startWorldY, curWorldY),
        });
      };

      let unsubscribe: () => void = () => {};

      const onUp = (e: PointerEvent) => {
        const m = marqueeRef.current;
        unsubscribe();
        if (!m || e.pointerId !== m.pointerId) return;
        marqueeRef.current = null;
        if (!m.moved) {
          const target = e.target instanceof Element ? e.target : null;
          const endedOnOverlay = !!target && !target.closest('.ic-root');
          if (!m.additive && !endedOnOverlay) clearSelectionRef.current?.();
          setMarqueeRect(null);
          return;
        }
        // Commit the marquee-intersected set to selectedIds.
        const current = mediaRef.current ?? [];
        const dxScreen = e.clientX - m.startClientX;
        const dyScreen = e.clientY - m.startClientY;
        const v = viewRef.current!;
        const endWorldX = m.startWorldX + dxScreen / v.scale;
        const endWorldY = m.startWorldY + dyScreen / v.scale;
        const minX = Math.min(m.startWorldX, endWorldX);
        const minY = Math.min(m.startWorldY, endWorldY);
        const maxX = Math.max(m.startWorldX, endWorldX);
        const maxY = Math.max(m.startWorldY, endWorldY);
        const hit = new Set<string>();
        for (const item of current) {
          if (
            item.x + item.width >= minX &&
            item.x <= maxX &&
            item.y + item.height >= minY &&
            item.y <= maxY
          ) {
            hit.add(item.id);
          }
        }
        const next = m.additive ? new Set(m.baseSet) : new Set<string>();
        for (const id of hit) next.add(id);
        setSelectedIds(next);
        const newlyAdded = Array.from(hit).find((id) => !m.baseSet.has(id));
        setLastSelectedId(
          newlyAdded ?? Array.from(next)[next.size - 1] ?? null,
        );
        setMarqueeRect(null);
      };

      unsubscribe = subscribeWindowDrag({ onMove, onUp });
    },
    [
      clearSelectionRef,
      mediaRef,
      selectedIdsRef,
      setLastSelectedId,
      setSelectedIds,
      viewRef,
    ],
  );

  return { marqueeRect, marqueeRef, handleBackgroundPointerDown };
}
