import { useVisionCanvas } from '../VisionCanvasContext';

export function useVisionImport() {
  const { preview, onConfirmImport } = useVisionCanvas();
  return { preview, onConfirmImport };
}
