import { useMemo } from 'react';
import { NodeInspectorSidebar } from './NodeInspectorSidebar';
import { useLlmCanvas } from '../context/LlmCanvasContext';
import { useLlmNodes } from '../context/slices/useLlmNodes';
import { useLlmMutations } from '../context/slices/useLlmMutations';

export function LlmInspectorSidebar() {
  const { selectedId, setSelectedId, focusedExample } = useLlmCanvas();
  const { nodes } = useLlmNodes();
  const { nodeMut } = useLlmMutations();

  const selectedNode = selectedId
    ? nodes.find((n) => n.id === selectedId && n.kind !== 'start') ?? null
    : null;

  const focused = useMemo(() => {
    if (!focusedExample || !selectedNode) return null;
    if (focusedExample.nodeId !== selectedNode.id) return null;
    return { idx: focusedExample.idx, token: focusedExample.token };
  }, [focusedExample, selectedNode]);

  if (!selectedNode) return null;

  return (
    <NodeInspectorSidebar
      node={selectedNode}
      onClose={() => setSelectedId(null)}
      onPatch={nodeMut.patch}
      focusedExample={focused}
    />
  );
}
