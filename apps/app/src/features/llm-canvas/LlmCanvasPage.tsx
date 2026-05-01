import { useMemo, useState } from 'react';
import { CanvasPage, CanvasShell, useCanvasShell } from '../canvas-core';
import {
  EdgeOverlay,
  LLM_VIEW_STORAGE_KEY,
  LlmCanvasModals,
  LlmCanvasProvider,
  Node as CanvasNode,
  NodeInspectorSidebar,
  StepNameInput,
  StepSearchPalette,
  useLlmCanvas,
  useLlmConnect,
  useLlmMutations,
  useLlmNodes,
} from './';
import '../../App.css';

type LlmCanvasPageProps = { projectId: string };

export function LlmCanvasPage({ projectId }: LlmCanvasPageProps) {
  return (
    <CanvasPage
      projectId={projectId}
      viewKey={LLM_VIEW_STORAGE_KEY}
      searchAriaLabel="Search steps (⌘K / Ctrl+K)"
      searchTitle="Search steps (⌘K)"
      modals={(m) => <LlmCanvasModals {...m} />}
    >
      <LlmCanvasProvider>
        <LlmCanvasBody />
      </LlmCanvasProvider>
    </CanvasPage>
  );
}

function LlmCanvasBody() {
  const { view, searchOpen, setSearchOpen } = useCanvasShell();

  const { nodes, edges, nodeSizes, handleMeasure } = useLlmNodes();
  const { selectedId, setSelectedId } = useLlmCanvas();
  const [focusedExample, setFocusedExample] = useState<{
    nodeId: string;
    idx: number;
    token: number;
  } | null>(null);

  const { nodeMut, edgeMut } = useLlmMutations();
  void edgeMut.remove;
  const {
    connecting,
    naming,
    startConnect,
    cancelConnect,
    commitStep,
    rerouting,
    startReroute,
  } = useLlmConnect();

  const stepNodes = nodes.filter((n) => n.kind === 'step');
  const selectedNode = selectedId
    ? nodes.find((n) => n.id === selectedId && n.kind !== 'start') ?? null
    : null;

  const sidebarFocusedExample = useMemo(() => {
    if (!focusedExample || !selectedNode) return null;
    if (focusedExample.nodeId !== selectedNode.id) return null;
    return { idx: focusedExample.idx, token: focusedExample.token };
  }, [focusedExample, selectedNode]);

  const worldToScreen = (wx: number, wy: number) => ({
    x: wx * view.scale + view.x,
    y: wy * view.scale + view.y,
  });

  return (
    <>
      <CanvasShell.Canvas>
        {nodes
          .filter((n) => n.kind === 'start')
          .map((n) => (
            <CanvasNode
              key={n.id}
              id={n.id}
              x={n.x}
              y={n.y}
              scale={view.scale}
              name={n.name}
              icon="ri-play-circle-fill"
              variant="accent"
              port="right"
              onMove={nodeMut.move}
              onMoveCommit={nodeMut.moveCommit}
              onConnectStart={(p) => startConnect(n.id, p)}
              onMeasure={handleMeasure}
            />
          ))}
        {stepNodes.map((n) => (
          <CanvasNode
            key={n.id}
            id={n.id}
            x={n.x}
            y={n.y}
            scale={view.scale}
            name={n.name}
            port="right"
            canRename
            canDelete
            selected={selectedId === n.id || rerouting?.snapTargetId === n.id}
            onMove={nodeMut.move}
            onMoveCommit={nodeMut.moveCommit}
            onRename={nodeMut.rename}
            onDelete={nodeMut.remove}
            onConnectStart={(p) => startConnect(n.id, p)}
            onMeasure={handleMeasure}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? cur : id))}
          />
        ))}
        <EdgeOverlay
          nodes={nodes}
          nodeSizes={nodeSizes}
          edges={edges}
          viewScale={view.scale}
          connecting={connecting}
          rerouting={rerouting}
          onEdgeEndDragStart={startReroute}
        />
      </CanvasShell.Canvas>

      <CanvasShell.Overlays>
        {naming &&
          (() => {
            const p = worldToScreen(naming.x, naming.y);
            return (
              <StepNameInput
                anchorScreenX={p.x}
                anchorScreenY={p.y}
                onSubmit={commitStep}
                onCancel={cancelConnect}
              />
            );
          })()}
      </CanvasShell.Overlays>

      <CanvasShell.Sidebar>
        {selectedNode && (
          <NodeInspectorSidebar
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            onPatch={nodeMut.patch}
            focusedExample={sidebarFocusedExample}
          />
        )}
      </CanvasShell.Sidebar>

      <CanvasShell.SearchPalette>
        <StepSearchPalette
          open={searchOpen}
          steps={stepNodes}
          onSelect={(step, exampleIdx) => {
            setSearchOpen(false);
            setSelectedId(step.id);
            if (exampleIdx !== undefined) {
              setFocusedExample({
                nodeId: step.id,
                idx: exampleIdx,
                token: Date.now(),
              });
            }
          }}
          onClose={() => setSearchOpen(false)}
        />
      </CanvasShell.SearchPalette>
    </>
  );
}
