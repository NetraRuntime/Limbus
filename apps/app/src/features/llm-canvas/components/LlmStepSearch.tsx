import { useCanvasShell } from '../../canvas-core';
import { StepSearchPalette } from './StepSearchPalette';
import { useLlmCanvas } from '../context/LlmCanvasContext';
import { useLlmNodes } from '../context/slices/useLlmNodes';

export function LlmStepSearch() {
  const { searchOpen, setSearchOpen } = useCanvasShell();
  const { setSelectedId, setFocusedExample } = useLlmCanvas();
  const { nodes } = useLlmNodes();
  const stepNodes = nodes.filter((n) => n.kind === 'step');
  return (
    <StepSearchPalette
      open={searchOpen}
      steps={stepNodes}
      onSelect={(step, exampleIdx) => {
        setSearchOpen(false);
        setSelectedId(step.id);
        if (exampleIdx !== undefined) {
          setFocusedExample({
            nodeId: step.id,
            idx: exampleIdx,
            token: Date.now(),
          });
        }
      }}
      onClose={() => setSearchOpen(false)}
    />
  );
}
