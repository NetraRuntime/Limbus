import { useCallback, useState } from 'react';

export type NodeSize = { w: number; h: number };
export type NodeSizes = Record<string, NodeSize>;

/**
 * Tracks measured rendered sizes per node id. Caller wires `onMeasure`
 * into each Node so its ResizeObserver feeds back here; the map drives
 * port positions and edge anchoring.
 */
export function useNodeSizes() {
  const [sizes, setSizes] = useState<NodeSizes>({});

  const handleMeasure = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setSizes((prev) => {
        const cur = prev[id];
        if (cur && cur.w === size.width && cur.h === size.height) return prev;
        return { ...prev, [id]: { w: size.width, h: size.height } };
      });
    },
    [],
  );

  return { sizes, handleMeasure };
}
