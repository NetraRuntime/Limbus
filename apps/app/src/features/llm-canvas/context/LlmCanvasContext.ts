import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { NodeRecord, EdgeRecord } from '../types/canvas';
import type { NodeSizes } from '../hooks/useNodeSizes';
import type { useNodeMutations } from '../hooks/useNodeMutations';
import type { useEdgeMutations } from '../hooks/useEdgeMutations';
import type { useConnectGesture } from '../hooks/useConnectGesture';
import type { useEdgeRerouteGesture } from '../hooks/useEdgeRerouteGesture';
import type { useCommitStep } from '../hooks/useCommitStep';

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
  nodeMut: ReturnType<typeof useNodeMutations>;
  edgeMut: ReturnType<typeof useEdgeMutations>;
  connecting: ReturnType<typeof useConnectGesture>['connecting'];
  naming: ReturnType<typeof useConnectGesture>['naming'];
  startConnect: ReturnType<typeof useConnectGesture>['start'];
  cancelConnect: ReturnType<typeof useConnectGesture>['cancel'];
  commitStep: ReturnType<typeof useCommitStep>;
  rerouting: ReturnType<typeof useEdgeRerouteGesture>['rerouting'];
  startReroute: ReturnType<typeof useEdgeRerouteGesture>['start'];
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
