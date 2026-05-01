import { useLlmCanvas } from '../LlmCanvasContext';

export function useLlmConnect() {
  const {
    connecting,
    naming,
    startConnect,
    cancelConnect,
    commitStep,
    rerouting,
    startReroute,
  } = useLlmCanvas();
  return {
    connecting,
    naming,
    startConnect,
    cancelConnect,
    commitStep,
    rerouting,
    startReroute,
  };
}
