import { useCanvasShell } from '../../canvas-core';
import { EdgeOverlay } from './EdgeOverlay';
import { useLlmNodes } from '../context/slices/useLlmNodes';
import { useLlmConnect } from '../context/slices/useLlmConnect';

export function LlmEdgeOverlay() {
  const { view } = useCanvasShell();
  const { nodes, edges, nodeSizes } = useLlmNodes();
  const { connecting, rerouting, startReroute } = useLlmConnect();

  return (
    <EdgeOverlay
      nodes={nodes}
      nodeSizes={nodeSizes}
      edges={edges}
      viewScale={view.scale}
      connecting={connecting}
      rerouting={rerouting}
      onEdgeEndDragStart={startReroute}
    />
  );
}
