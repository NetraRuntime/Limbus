import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  resizeBboxEntry,
  type MaskIdentity,
  type ReadyMaskEntry,
} from '../../segmentation';
import type { UseHistoryReturn } from '../../../lib/history';
import type {
  CanvasActionMeta,
} from '../../../lib/canvasHistory';
import type { View } from '../../canvas-core';
import type {
  CanvasMedia,
  ConnState,
  SegmentState,
  TagSegment,
} from '../lib';

export type ResizeHandle =
  | 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

type DragState = {
  pointerId: number;
  handle: ResizeHandle;
  imageId: string;
  tag: string;
  maskIndex: number;
  startBbox: [number, number, number, number];
  startClientX: number;
  startClientY: number;
  fx: number;
  fy: number;
  maskW: number;
  maskH: number;
  before: ReadyMaskEntry;
  moved: boolean;
};

type Args = {
  projectId: string;
  viewRef: RefObject<View>;
  mediaRef: RefObject<CanvasMedia[]>;
  segmentsRef: RefObject<Record<string, SegmentState>>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  history: UseHistoryReturn<CanvasActionMeta>;
  replaceReadyTag: (
    imageId: string,
    tag: string,
    entry: ReadyMaskEntry | null,
  ) => void;
};

export type BboxResizeGesture = {
  activeResize: ResizeHandle | null;
  handlePointerDown: (
    e: React.PointerEvent<HTMLSpanElement>,
    id: MaskIdentity,
    handle: ResizeHandle,
  ) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLSpanElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLSpanElement>) => void;
};

const computeResizedBbox = (
  s: DragState,
  clientX: number,
  clientY: number,
  scale: number,
): [number, number, number, number] => {
  const dxMask = (clientX - s.startClientX) / scale / s.fx;
  const dyMask = (clientY - s.startClientY) / scale / s.fy;
  let [x1, y1, x2, y2] = s.startBbox;
  const dragsLeft = s.handle === 'tl' || s.handle === 'bl' || s.handle === 'l';
  const dragsRight = s.handle === 'tr' || s.handle === 'br' || s.handle === 'r';
  const dragsTop = s.handle === 'tl' || s.handle === 'tr' || s.handle === 't';
  const dragsBottom = s.handle === 'bl' || s.handle === 'br' || s.handle === 'b';
  if (dragsLeft) x1 = Math.max(0, Math.min(x2 - 1, x1 + dxMask));
  if (dragsRight) x2 = Math.min(s.maskW, Math.max(x1 + 1, x2 + dxMask));
  if (dragsTop) y1 = Math.max(0, Math.min(y2 - 1, y1 + dyMask));
  if (dragsBottom) y2 = Math.min(s.maskH, Math.max(y1 + 1, y2 + dyMask));
  return [x1, y1, x2, y2];
};

export function useBboxResizeGesture({
  projectId,
  viewRef,
  mediaRef,
  segmentsRef,
  setSegments,
  setConn,
  history,
  replaceReadyTag,
}: Args): BboxResizeGesture {
  const dragRef = useRef<DragState | null>(null);
  // State (not ref) so the precision-guide overlay re-renders on start/end.
  const [activeResize, setActiveResize] = useState<ResizeHandle | null>(null);

  const applyToSegments = useCallback(
    (
      imageId: string,
      tag: string,
      maskIndex: number,
      nextBbox: [number, number, number, number],
    ) => {
      const key = tag.toLowerCase();
      setSegments((prev) => {
        const cur = prev[imageId];
        if (!cur) return prev;
        let changed = false;
        const nextEntries = cur.entries.map((e) => {
          if (e.status !== 'ready' || e.tag.toLowerCase() !== key) return e;
          const masks = e.response.masks.map((mm, i) => {
            if (i !== maskIndex) return mm;
            const prevBbox = mm.bbox;
            if (
              prevBbox &&
              prevBbox[0] === nextBbox[0] &&
              prevBbox[1] === nextBbox[1] &&
              prevBbox[2] === nextBbox[2] &&
              prevBbox[3] === nextBbox[3]
            ) {
              return mm;
            }
            changed = true;
            return { ...mm, bbox: nextBbox };
          });
          return changed
            ? { ...e, response: { ...e.response, masks } }
            : e;
        });
        if (!changed) return prev;
        return { ...prev, [imageId]: { entries: nextEntries } };
      });
    },
    [setSegments],
  );

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLSpanElement>,
      id: MaskIdentity,
      handle: ResizeHandle,
    ) => {
      if (e.button !== 0) return;
      const current = segmentsRef.current?.[id.imageId];
      if (!current) return;
      const ready = current.entries.find(
        (x): x is TagSegment & { status: 'ready' } =>
          x.status === 'ready' && x.tag.toLowerCase() === id.tag.toLowerCase(),
      );
      if (!ready) return;
      const mask = ready.response.masks[id.maskIndex];
      if (!mask || !mask.bbox) return;
      const mediaItem = mediaRef.current?.find((m) => m.id === id.imageId);
      if (!mediaItem || mediaItem.kind !== 'image') return;
      const fx = mediaItem.width / mask.width;
      const fy = mediaItem.height / mask.height;
      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: {
          ...ready.response,
          masks: ready.response.masks.map((mm) => ({ ...mm })),
        },
      };
      dragRef.current = {
        pointerId: e.pointerId,
        handle,
        imageId: id.imageId,
        tag: ready.tag,
        maskIndex: id.maskIndex,
        startBbox: [...mask.bbox] as [number, number, number, number],
        startClientX: e.clientX,
        startClientY: e.clientY,
        fx,
        fy,
        maskW: mask.width,
        maskH: mask.height,
        before,
        moved: false,
      };
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // pointer capture can fail mid-transition; drag still tracked via ref.
      }
      e.stopPropagation();
      e.preventDefault();
    },
    [mediaRef, segmentsRef],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const s = dragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const scale = viewRef.current?.scale ?? 1;
      const next = computeResizedBbox(s, e.clientX, e.clientY, scale);
      if (!s.moved) {
        const dx = Math.abs(e.clientX - s.startClientX);
        const dy = Math.abs(e.clientY - s.startClientY);
        if (dx < 1 && dy < 1) return;
        s.moved = true;
        setActiveResize(s.handle);
      }
      applyToSegments(s.imageId, s.tag, s.maskIndex, next);
    },
    [applyToSegments, viewRef],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const s = dragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // Already released or the element is gone; nothing to do.
      }
      dragRef.current = null;
      setActiveResize(null);
      if (!s.moved) return;
      const scale = viewRef.current?.scale ?? 1;
      const finalBbox = computeResizedBbox(s, e.clientX, e.clientY, scale);
      const before = s.before;
      const after: ReadyMaskEntry = {
        tag: before.tag,
        status: 'ready',
        response: {
          ...before.response,
          masks: before.response.masks.map((mm, i) =>
            i === s.maskIndex ? { ...mm, bbox: finalBbox } : mm,
          ),
        },
      };
      // Segments already reflect `after` from the last pointermove, so do()
      // reapplies an equivalent state but still triggers the upsert — mirrors
      // the deleteMaskEntry call site which does the same alreadyApplied dance.
      const entry = resizeBboxEntry({
        projectId,
        imageId: s.imageId,
        tag: s.tag,
        maskIndex: s.maskIndex,
        before,
        after,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [history, projectId, replaceReadyTag, setConn, viewRef],
  );

  return {
    activeResize,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
