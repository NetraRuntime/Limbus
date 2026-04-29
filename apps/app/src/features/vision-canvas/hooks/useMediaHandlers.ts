import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { InfiniteCanvasHandle } from '../../canvas-core';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  type CanvasMedia,
  type DragState,
  type MediaPointerEvent,
} from '../lib';
import type { CanvasTool } from '../components/MediaToolbar';

type ContextMenuPos = { id: string; x: number; y: number };

type Args = {
  canvasRef: RefObject<InfiniteCanvasHandle>;
  mediaRef: RefObject<CanvasMedia[]>;
  dragRef: MutableRefObject<DragState | null>;
  shiftToggledRef: MutableRefObject<boolean>;
  toolRef: MutableRefObject<CanvasTool>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuPos | null>>;
  clearHideTimer: () => void;
  scheduleHide: () => void;
  beginDrag: (
    e: MediaPointerEvent,
    m: CanvasMedia,
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>,
    setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>,
  ) => boolean;
  beginDraw: (e: MediaPointerEvent, m: CanvasMedia) => boolean;
};

export type MediaHandlers = {
  handleMediaEnter: (id: string) => void;
  handleMediaLeave: () => void;
  handleMediaClick: (e: React.MouseEvent, id: string) => void;
  handleMediaDoubleClick: (e: React.MouseEvent, m: CanvasMedia) => void;
  handleMediaContextMenu: (e: React.MouseEvent, id: string) => void;
  handleSidebarSelect: (id: string) => void;
  handleMediaPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
};

export function useMediaHandlers({
  canvasRef,
  mediaRef,
  dragRef,
  shiftToggledRef,
  toolRef,
  setSelectedIds,
  setLastSelectedId,
  setHoverId,
  setContextMenu,
  clearHideTimer,
  scheduleHide,
  beginDrag,
  beginDraw,
}: Args): MediaHandlers {
  const handleMediaEnter = useCallback(
    (id: string) => {
      clearHideTimer();
      setHoverId(id);
    },
    [clearHideTimer, setHoverId],
  );

  const handleMediaLeave = useCallback(() => {
    scheduleHide();
  }, [scheduleHide]);

  const handleMediaClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      // Shift already toggled in pointerdown — don't re-apply here.
      if (shiftToggledRef.current) {
        shiftToggledRef.current = false;
        return;
      }
      if (dragRef.current?.anchorId === id && dragRef.current.moved) return;
      clearHideTimer();
      setHoverId(id);
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
    },
    [
      clearHideTimer,
      dragRef,
      setHoverId,
      setLastSelectedId,
      setSelectedIds,
      shiftToggledRef,
    ],
  );

  const handleMediaDoubleClick = useCallback(
    (e: React.MouseEvent, m: CanvasMedia) => {
      e.stopPropagation();
      if (dragRef.current?.moved) return;
      canvasRef.current?.focusOn(
        { x: m.x, y: m.y, width: m.width, height: m.height },
        { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [canvasRef, dragRef],
  );

  const handleMediaContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      clearHideTimer();
      setHoverId(id);
      setSelectedIds((prev) => {
        if (prev.has(id)) return prev;
        return new Set([id]);
      });
      setLastSelectedId(id);
      setContextMenu({ id, x: e.clientX, y: e.clientY });
    },
    [
      clearHideTimer,
      setContextMenu,
      setHoverId,
      setLastSelectedId,
      setSelectedIds,
    ],
  );

  const handleSidebarSelect = useCallback(
    (id: string) => {
      const target = (mediaRef.current ?? []).find((m) => m.id === id);
      if (!target) return;
      clearHideTimer();
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
      setHoverId(id);
      canvasRef.current?.focusOn(
        {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        },
        { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [
      canvasRef,
      clearHideTimer,
      mediaRef,
      setHoverId,
      setLastSelectedId,
      setSelectedIds,
    ],
  );

  const handleMediaPointerDown = useCallback(
    (e: MediaPointerEvent, m: CanvasMedia) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (e.shiftKey || toolRef.current !== 'box') {
        beginDrag(e, m, setSelectedIds, setLastSelectedId);
        return;
      }
      beginDraw(e, m);
    },
    [beginDraw, beginDrag, setLastSelectedId, setSelectedIds, toolRef],
  );

  return {
    handleMediaEnter,
    handleMediaLeave,
    handleMediaClick,
    handleMediaDoubleClick,
    handleMediaContextMenu,
    handleSidebarSelect,
    handleMediaPointerDown,
  };
}
