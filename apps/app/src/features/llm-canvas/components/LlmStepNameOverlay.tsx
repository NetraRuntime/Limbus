import { useCanvasShell } from '../../canvas-core';
import { StepNameInput } from './StepNameInput';
import { useLlmConnect } from '../context/slices/useLlmConnect';

export function LlmStepNameOverlay() {
  const { view } = useCanvasShell();
  const { naming, commitStep, cancelConnect } = useLlmConnect();
  if (!naming) return null;
  const x = naming.x * view.scale + view.x;
  const y = naming.y * view.scale + view.y;
  return (
    <StepNameInput
      anchorScreenX={x}
      anchorScreenY={y}
      onSubmit={commitStep}
      onCancel={cancelConnect}
    />
  );
}
