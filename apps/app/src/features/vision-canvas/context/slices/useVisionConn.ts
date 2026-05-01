import { useVisionCanvas } from '../VisionCanvasContext';

export function useVisionConn() {
  const { conn, setConn, sam3Error, sam3Available } = useVisionCanvas();
  return { conn, setConn, sam3Error, sam3Available };
}
