import { useCanvasShell } from '../../canvas-core';
import { Node as CanvasNode } from './Node';
import { useLlmNodes } from '../context/slices/useLlmNodes';
import { useLlmMutations } from '../context/slices/useLlmMutations';
import { useLlmConnect } from '../context/slices/useLlmConnect';

export function LlmStartNodes() {
  const { view } = useCanvasShell();
  const { nodes, handleMeasure } = useLlmNodes();
  const { nodeMut } = useLlmMutations();
  const { startConnect } = useLlmConnect();

  return (
    <>
      {nodes
        .filter((n) => n.kind === 'start')
        .map((n) => (
          <CanvasNode
            key={n.id}
            id={n.id}
            x={n.x}
            y={n.y}
            scale={view.scale}
            name={n.name}
            icon="ri-play-circle-fill"
            variant="accent"
            port="right"
            onMove={nodeMut.move}
            onMoveCommit={nodeMut.moveCommit}
            onConnectStart={(p) => startConnect(n.id, p)}
            onMeasure={handleMeasure}
          />
        ))}
    </>
  );
}
