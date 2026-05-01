import { useCanvasPage } from '../../canvas-core';
import { LlmCanvasModals } from './LlmCanvasModals';

export function LlmCanvasModalsConnected() {
  const { modalsCtx } = useCanvasPage();
  return <LlmCanvasModals {...modalsCtx} />;
}
