import { useCanvasShell } from '../../canvas-core';
import { Node as CanvasNode } from './Node';
import { useLlmCanvas } from '../context/LlmCanvasContext';
import { useLlmNodes } from '../context/slices/useLlmNodes';
import { useLlmMutations } from '../context/slices/useLlmMutations';
import { useLlmConnect } from '../context/slices/useLlmConnect';

export function LlmStepNodes() {
  const { view } = useCanvasShell();
  const { selectedId, setSelectedId } = useLlmCanvas();
  const { nodes, handleMeasure } = useLlmNodes();
  const { nodeMut } = useLlmMutations();
  const { startConnect, rerouting } = useLlmConnect();

  return (
    <>
      {nodes
        .filter((n) => n.kind === 'step')
        .map((n) => (
          <CanvasNode
            key={n.id}
            id={n.id}
            x={n.x}
            y={n.y}
            scale={view.scale}
            name={n.name}
            port="right"
            canRename
            canDelete
            selected={selectedId === n.id || rerouting?.snapTargetId === n.id}
            onMove={nodeMut.move}
            onMoveCommit={nodeMut.moveCommit}
            onRename={nodeMut.rename}
            onDelete={nodeMut.remove}
            onConnectStart={(p) => startConnect(n.id, p)}
            onMeasure={handleMeasure}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? cur : id))}
          />
        ))}
    </>
  );
}
