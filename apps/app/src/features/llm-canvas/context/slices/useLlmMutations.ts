import { useLlmCanvas } from '../LlmCanvasContext';

export function useLlmMutations() {
  const { nodeMut, edgeMut } = useLlmCanvas();
  return { nodeMut, edgeMut };
}
