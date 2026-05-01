import { useLlmCanvas } from '../LlmCanvasContext';

export function useLlmNodes() {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    nodeSizes,
    handleMeasure,
  } = useLlmCanvas();
  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    nodeSizes,
    handleMeasure,
  };
}
