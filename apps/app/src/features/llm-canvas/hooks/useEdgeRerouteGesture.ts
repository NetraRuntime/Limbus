import { useCallback, useState, type RefObject } from 'react';
import type { InfiniteCanvasHandle } from '../../canvas-core';
import type { NodeRecord } from '../types/canvas';
import type { NodeSizes } from './useNodeSizes';

export type Rerouting = {
  edgeId: string;
  end: 'from' | 'to';
  cursorX: number;
  cursorY: number;
  snapTargetId: string | null;
};

type Args = {
  canvasRef: RefObject<InfiniteCanvasHandle>;
  nodesRef: RefObject<NodeRecord[]>;
  nodeSizes: NodeSizes;
  onCommit: (edgeId: string, end: 'from' | 'to', newNodeId: string) => void;
};

/**
 * Drags an edge endpoint to a different node. While active, the dragged
 * end follows the cursor and any node under it becomes `snapTargetId`.
 * On pointer-up, `onCommit` fires if a snap target was found.
 */
export function useEdgeRerouteGesture({
  canvasRef,
  nodesRef,
  nodeSizes,
  onCommit,
}: Args) {
  const [rerouting, setRerouting] = useState<Rerouting | null>(null);

  const start = useCallback(
    (edgeId: string, end: 'from' | 'to', clientX: number, clientY: number) => {
      const v = canvasRef.current?.getView();
      if (!v) return;
      const wx0 = (clientX - v.x) / v.scale;
      const wy0 = (clientY - v.y) / v.scale;
      setRerouting({ edgeId, end, cursorX: wx0, cursorY: wy0, snapTargetId: null });

      const findNodeAt = (wx: number, wy: number): string | null => {
        const nodes = nodesRef.current ?? [];
        for (const n of nodes) {
          const size = nodeSizes[n.id];
          if (!size) continue;
          if (
            wx >= n.x &&
            wx <= n.x + size.w &&
            wy >= n.y &&
            wy <= n.y + size.h
          ) {
            return n.id;
          }
        }
        return null;
      };

      const onMove = (ev: PointerEvent) => {
        const view = canvasRef.current?.getView();
        if (!view) return;
        const wx = (ev.clientX - view.x) / view.scale;
        const wy = (ev.clientY - view.y) / view.scale;
        const snap = findNodeAt(wx, wy);
        setRerouting((prev) =>
          prev ? { ...prev, cursorX: wx, cursorY: wy, snapTargetId: snap } : prev,
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setRerouting((prev) => {
          if (prev && prev.snapTargetId) {
            onCommit(prev.edgeId, prev.end, prev.snapTargetId);
          }
          return null;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [canvasRef, nodesRef, nodeSizes, onCommit],
  );

  return { rerouting, start };
}
