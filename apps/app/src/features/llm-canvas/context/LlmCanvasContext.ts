import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { NodeRecord, EdgeRecord } from '../types/canvas';
import type { NodeSizes } from '../hooks/useNodeSizes';

export type LlmCanvasValue = {
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  setNodes: Dispatch<SetStateAction<NodeRecord[]>>;
  setEdges: Dispatch<SetStateAction<EdgeRecord[]>>;
  nodesRef: MutableRefObject<NodeRecord[]>;
  edgesRef: MutableRefObject<EdgeRecord[]>;
  nodeSizes: NodeSizes;
  handleMeasure: (id: string, size: { width: number; height: number }) => void;
};

const Ctx = createContext<LlmCanvasValue | null>(null);
Ctx.displayName = 'LlmCanvasContext';

export const LlmCanvasContextProvider = Ctx.Provider;

export function useLlmCanvas(): LlmCanvasValue {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('useLlmCanvas must be used inside an LlmCanvasProvider.');
  }
  return value;
}
