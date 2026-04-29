import { useCallback, useRef, useState, type RefObject } from 'react';
import type { View } from '../../canvas-core';
import {
  DRAW_BOX_MIN_SIZE_PX,
  genBoxId,
  subscribeWindowDrag,
  type CanvasMedia,
  type DrawBoxState,
  type MediaPointerEvent,
  type PendingBoxLabel,
} from '../lib';

type Args = {
  viewRef: RefObject<View>;
  selectedIdsRef: RefObject<Set<string>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingBoxLabel: React.Dispatch<React.SetStateAction<PendingBoxLabel | null>>;
};

export type DrawBoxGesture = {
  drawBoxPreview: DrawBoxState | null;
  drawBoxRef: RefObject<DrawBoxState | null>;
  /**
   * Returns true when the down event was claimed (image + box-tool +
   * primary button) so the caller can early-return out of its dispatcher.
   */
  beginDraw: (e: MediaPointerEvent, m: CanvasMedia) => boolean;
};

export function useDrawBoxGesture({
  viewRef,
  selectedIdsRef,
  setSelectedIds,
  setLastSelectedId,
  setPendingBoxLabel,
}: Args): DrawBoxGesture {
  const [drawBoxPreview, setDrawBoxPreview] = useState<DrawBoxState | null>(null);
  const drawBoxRef = useRef<DrawBoxState | null>(null);

  const beginDraw = useCallback(
    (e: MediaPointerEvent, m: CanvasMedia): boolean => {
      // Box tool: click-drag on an image draws a new bounding box. Videos
      // aren't supported yet — fall through so they don't drag.
      if (m.kind !== 'image') return false;
      // Starting a new draw discards any unlabeled box waiting on a label.
      // Matches Photoshop/Figma "new selection replaces old" semantics.
      setPendingBoxLabel(null);
      const v = viewRef.current!;
      // InfiniteCanvas is position:fixed inset:0, so client coords map
      // directly to its local space; no rect offset needed.
      const worldX = (e.clientX - v.x) / v.scale;
      const worldY = (e.clientY - v.y) / v.scale;
      const cx = Math.max(m.x, Math.min(m.x + m.width, worldX));
      const cy = Math.max(m.y, Math.min(m.y + m.height, worldY));
      const state: DrawBoxState = {
        imageId: m.id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: cx,
        startWorldY: cy,
        currentWorldX: cx,
        currentWorldY: cy,
        imageX: m.x,
        imageY: m.y,
        imageW: m.width,
        imageH: m.height,
        moved: false,
      };
      drawBoxRef.current = state;
      setDrawBoxPreview(state);
      // Keep this image active so the toolbar stays anchored to it while
      // drawing. Matches handleMediaClick's single-select behavior.
      const sel = selectedIdsRef.current;
      if (!sel || !sel.has(m.id) || sel.size !== 1) {
        setSelectedIds(new Set([m.id]));
        setLastSelectedId(m.id);
      }

      const onMove = (ev: PointerEvent) => {
        const b = drawBoxRef.current;
        if (!b || ev.pointerId !== b.pointerId) return;
        const dx = ev.clientX - b.startClientX;
        const dy = ev.clientY - b.startClientY;
        if (!b.moved && Math.hypot(dx, dy) < DRAW_BOX_MIN_SIZE_PX) return;
        const vNow = viewRef.current!;
        const wx = (ev.clientX - vNow.x) / vNow.scale;
        const wy = (ev.clientY - vNow.y) / vNow.scale;
        const ccx = Math.max(b.imageX, Math.min(b.imageX + b.imageW, wx));
        const ccy = Math.max(b.imageY, Math.min(b.imageY + b.imageH, wy));
        const next: DrawBoxState = {
          ...b,
          currentWorldX: ccx,
          currentWorldY: ccy,
          moved: true,
        };
        drawBoxRef.current = next;
        setDrawBoxPreview(next);
      };

      let unsubscribe: () => void = () => {};

      const onUp = (ev: PointerEvent) => {
        const b = drawBoxRef.current;
        unsubscribe();
        if (!b || ev.pointerId !== b.pointerId) return;
        drawBoxRef.current = null;
        setDrawBoxPreview(null);
        if (!b.moved) return;
        const x1 = Math.min(b.startWorldX, b.currentWorldX);
        const y1 = Math.min(b.startWorldY, b.currentWorldY);
        const x2 = Math.max(b.startWorldX, b.currentWorldX);
        const y2 = Math.max(b.startWorldY, b.currentWorldY);
        // Reject degenerate boxes (hairline drags). The pixel threshold is
        // applied in screen space so a zoomed-out drag still needs real
        // motion to commit.
        const vNow = viewRef.current!;
        const pxW = (x2 - x1) * vNow.scale;
        const pxH = (y2 - y1) * vNow.scale;
        if (pxW < DRAW_BOX_MIN_SIZE_PX || pxH < DRAW_BOX_MIN_SIZE_PX) return;
        const rel: [number, number, number, number] = [
          x1 - b.imageX,
          y1 - b.imageY,
          x2 - b.imageX,
          y2 - b.imageY,
        ];
        // Park the box in pendingBoxLabel and let the popover collect a
        // label. Not committed to userBoxes and SAM3 not invoked until the
        // user confirms — cancel just clears state.
        setPendingBoxLabel({
          imageId: b.imageId,
          boxId: genBoxId(),
          relBox: rel,
          imageW: b.imageW,
          imageH: b.imageH,
          worldRect: { x1, y1, x2, y2 },
        });
      };

      unsubscribe = subscribeWindowDrag({ onMove, onUp });
      return true;
    },
    [
      selectedIdsRef,
      setLastSelectedId,
      setPendingBoxLabel,
      setSelectedIds,
      viewRef,
    ],
  );

  return { drawBoxPreview, drawBoxRef, beginDraw };
}
