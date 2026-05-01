import { useRef, useState, type ReactNode } from 'react';
import {
  useCanvasPage,
  useCanvasShell,
  type InfiniteCanvasHandle,
} from '../../canvas-core';
import { useLlmHydration } from '../hooks/useLlmHydration';
import { useNodeSizes } from '../hooks/useNodeSizes';
import { useNodeMutations } from '../hooks/useNodeMutations';
import { useEdgeMutations } from '../hooks/useEdgeMutations';
import { useConnectGesture } from '../hooks/useConnectGesture';
import { useCommitStep } from '../hooks/useCommitStep';
import { useEdgeRerouteGesture } from '../hooks/useEdgeRerouteGesture';
import { useSelectedNodeFocus } from '../hooks/useSelectedNodeFocus';
import { useLlmCanvasKeyboardShortcuts } from '../hooks/useLlmCanvasKeyboardShortcuts';
import {
  LlmCanvasContextProvider,
  type LlmCanvasValue,
} from './LlmCanvasContext';

type Props = { children: ReactNode };

export function LlmCanvasProvider({ children }: Props) {
  const { projectId, history } = useCanvasPage();
  const shell = useCanvasShell();
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;

  const { nodes, edges, setNodes, setEdges } = useLlmHydration(projectId);
  const { sizes: nodeSizes, handleMeasure } = useNodeSizes();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const nodeMut = useNodeMutations({
    history,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
  });
  const edgeMut = useEdgeMutations({ history, edgesRef, setEdges });

  const {
    connecting,
    naming,
    start: startConnect,
    cancel: cancelConnect,
  } = useConnectGesture({ canvasRef });
  const commitStep = useCommitStep({
    projectId,
    history,
    connecting,
    naming,
    setNodes,
    setEdges,
    cancel: cancelConnect,
  });
  const { rerouting, start: startReroute } = useEdgeRerouteGesture({
    canvasRef,
    nodesRef,
    nodeSizes,
    onCommit: edgeMut.reroute,
  });

  useSelectedNodeFocus({ canvasRef, nodesRef, nodeSizes, selectedId });
  useLlmCanvasKeyboardShortcuts({ setSelectedId });

  const value: LlmCanvasValue = {
    selectedId,
    setSelectedId,
    nodes,
    edges,
    setNodes,
    setEdges,
    nodesRef,
    edgesRef,
    nodeSizes,
    handleMeasure,
    nodeMut,
    edgeMut,
    connecting,
    naming,
    startConnect,
    cancelConnect,
    commitStep,
    rerouting,
    startReroute,
  };

  return (
    <LlmCanvasContextProvider value={value}>
      {children}
    </LlmCanvasContextProvider>
  );
}
