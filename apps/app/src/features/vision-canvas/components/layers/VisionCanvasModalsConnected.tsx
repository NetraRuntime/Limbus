import { useCanvasPage } from '../../../canvas-core';
import { useVisionImport } from '../../context/slices/useVisionImport';
import { VisionCanvasModals } from './VisionCanvasModals';

export function VisionCanvasModalsConnected() {
  const { modalsCtx } = useCanvasPage();
  const { preview, onConfirmImport } = useVisionImport();
  return (
    <VisionCanvasModals
      {...modalsCtx}
      preview={preview}
      onConfirmImport={onConfirmImport}
    />
  );
}
