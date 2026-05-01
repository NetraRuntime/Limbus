import { useRef, useState, type ReactNode } from 'react';
import { useCanvasPage } from '../../canvas-core';
import { useLlmHydration } from '../hooks/useLlmHydration';
import { useNodeSizes } from '../hooks/useNodeSizes';
import {
  LlmCanvasContextProvider,
  type LlmCanvasValue,
} from './LlmCanvasContext';

type Props = { children: ReactNode };

export function LlmCanvasProvider({ children }: Props) {
  const { projectId } = useCanvasPage();

  const { nodes, edges, setNodes, setEdges } = useLlmHydration(projectId);
  const { sizes: nodeSizes, handleMeasure } = useNodeSizes();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

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
  };

  return (
    <LlmCanvasContextProvider value={value}>
      {children}
    </LlmCanvasContextProvider>
  );
}
