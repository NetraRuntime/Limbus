import { useEffect, type RefObject } from 'react';
import type { InfiniteCanvasHandle } from '../../canvas-core';
import type { NodeRecord } from '../types/canvas';
import type { NodeSizes } from './useNodeSizes';

type Args = {
  canvasRef: RefObject<InfiniteCanvasHandle>;
  nodesRef: RefObject<NodeRecord[]>;
  nodeSizes: NodeSizes;
  selectedId: string | null;
};

/**
 * Pans/zooms the camera to bring the selected node into the unobscured
 * area. Reads the inspector sidebar's actual width once it has mounted
 * (defers one frame so layout is settled).
 */
export function useSelectedNodeFocus({
  canvasRef,
  nodesRef,
  nodeSizes,
  selectedId,
}: Args) {
  useEffect(() => {
    if (!selectedId) return;
    const node = nodesRef.current?.find((n) => n.id === selectedId);
    if (!node) return;
    const size = nodeSizes[selectedId];
    if (!size) return;

    const raf = requestAnimationFrame(() => {
      const sidebarEl = document.querySelector<HTMLElement>('.node-inspector');
      const sidebarWidth = sidebarEl
        ? sidebarEl.getBoundingClientRect().width + 24
        : 0;
      canvasRef.current?.focusOn(
        { x: node.x, y: node.y, width: size.w, height: size.h },
        { padding: 0.2, rightInset: sidebarWidth, maxScale: 1.2 },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, nodesRef, nodeSizes, selectedId]);
}
