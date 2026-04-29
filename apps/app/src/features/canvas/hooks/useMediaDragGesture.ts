import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  updateImagePosition,
  updateVideoPosition,
} from '../../../lib/pb';
import type { UseHistoryReturn } from '../../../lib/history';
import {
  moveEntry,
  type CanvasActionMeta,
} from '../../../lib/canvasHistory';
import type { View } from '../../../InfiniteCanvas';
import {
  DRAG_THRESHOLD_PX,
  type CanvasMedia,
  type ConnState,
  type DragOrig,
  type DragState,
  type MediaPointerEvent,
} from '../lib';

type Args = {
  viewRef: RefObject<View>;
  mediaRef: RefObject<CanvasMedia[]>;
  selectedIdsRef: RefObject<Set<string>>;
  /** Caller-owned ref so useVisibleMedia can keep dragging items in view. */
  dragRef: MutableRefObject<DragState | null>;
  setMedia: React.Dispatch<React.SetStateAction<CanvasMedia[]>>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  history: UseHistoryReturn<CanvasActionMeta>;
  bringToFront: (ids: Set<string>) => void;
};

export type MediaDragGesture = {
  dragRef: RefObject<DragState | null>;
  shiftToggledRef: MutableRefObject<boolean>;
  /**
   * Returns true when the down event was claimed (drag started or shift-
   * toggle handled) so the caller can early-return.
   */
  beginDrag: (
    e: MediaPointerEvent,
    m: CanvasMedia,
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
    setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>,
  ) => boolean;
  handlePointerMove: (e: MediaPointerEvent) => void;
  handlePointerUp: (e: MediaPointerEvent) => void;
};

export function useMediaDragGesture({
  viewRef,
  mediaRef,
  selectedIdsRef,
  dragRef,
  setMedia,
  setConn,
  history,
  bringToFront,
}: Args): MediaDragGesture {
  const shiftToggledRef = useRef(false);

  const beginDrag = useCallback(
    (
      e: MediaPointerEvent,
      m: CanvasMedia,
      setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
      setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>,
    ): boolean => {
      if (e.shiftKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(m.id)) next.delete(m.id);
          else next.add(m.id);
          return next;
        });
        setLastSelectedId(m.id);
        shiftToggledRef.current = true;
        // No pointer capture, no drag: shift is a selection gesture only.
        return true;
      }
      shiftToggledRef.current = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const sel = selectedIdsRef.current ?? new Set<string>();
      const ids = sel.has(m.id) ? sel : new Set<string>([m.id]);
      const orig = new Map<string, DragOrig>();
      for (const item of mediaRef.current ?? []) {
        if (ids.has(item.id)) {
          orig.set(item.id, { x: item.x, y: item.y, kind: item.kind });
        }
      }
      dragRef.current = {
        anchorId: m.id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        orig,
        moved: false,
        lastDx: 0,
        lastDy: 0,
      };
      // Covers the drag-without-selection case: clicking and dragging an
      // unselected item won't fire click (moved=true suppresses it), so
      // the selectedIds-driven raise effect wouldn't run. Raise here too.
      bringToFront(ids);
      return true;
    },
    [bringToFront, mediaRef, selectedIdsRef],
  );

  const handlePointerMove = useCallback(
    (e: MediaPointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const dxScreen = e.clientX - d.startX;
      const dyScreen = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const scale = viewRef.current?.scale ?? 1;
      const dx = dxScreen / scale;
      const dy = dyScreen / scale;
      d.lastDx = dx;
      d.lastDy = dy;
      setMedia((prev) =>
        prev.map((m) => {
          const o = d.orig.get(m.id);
          if (!o) return m;
          return { ...m, x: o.x + dx, y: o.y + dy };
        }),
      );
    },
    [setMedia, viewRef],
  );

  const handlePointerUp = useCallback(
    (e: MediaPointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // Already released or the element is gone; nothing to do.
      }
      const { moved, lastDx, lastDy, orig } = d;
      window.setTimeout(() => {
        if (dragRef.current && dragRef.current.pointerId === d.pointerId) {
          dragRef.current = null;
        }
      }, 0);
      if (!moved) return;
      const currentMedia = mediaRef.current ?? [];
      const moves: Array<{
        id: string;
        kind: 'image' | 'video';
        from: { x: number; y: number };
        to: { x: number; y: number };
      }> = [];
      for (const [id, o] of orig) {
        const stillPending = currentMedia.find((m) => m.id === id)?.pending;
        if (stillPending) continue;
        const persist =
          o.kind === 'video' ? updateVideoPosition : updateImagePosition;
        const nextX = o.x + lastDx;
        const nextY = o.y + lastDy;
        moves.push({
          id,
          kind: o.kind,
          from: { x: o.x, y: o.y },
          to: { x: nextX, y: nextY },
        });
        persist(id, { x: nextX, y: nextY })
          .then(() => setConn('ready'))
          .catch((err) => {
            console.warn('[pb] move failed for', id, err);
            setConn('offline');
            setMedia((prev) =>
              prev.map((mm) =>
                mm.id === id ? { ...mm, x: o.x, y: o.y } : mm,
              ),
            );
          });
      }
      if (moves.length > 0) {
        history.push(
          moveEntry({ moves, setMedia, onConn: setConn }),
          { alreadyApplied: true },
        );
      }
    },
    [history, mediaRef, setConn, setMedia],
  );

  return {
    dragRef,
    shiftToggledRef,
    beginDrag,
    handlePointerMove,
    handlePointerUp,
  };
}
