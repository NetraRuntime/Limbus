import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasShell,
  useCanvasShell,
  useCanvasTitle,
  useFitBounds,
  type InfiniteCanvasHandle,
} from './features/canvas-core';
import { DeletedBanner, useProject } from './features/projects';
import {
  EdgeOverlay,
  LLM_VIEW_STORAGE_KEY,
  LlmCanvasModals,
  Node as CanvasNode,
  NodeInspectorSidebar,
  StepNameInput,
  StepSearchPalette,
  useCommitStep,
  useConnectGesture,
  useEdgeMutations,
  useEdgeRerouteGesture,
  useLlmCanvasKeyboardShortcuts,
  useLlmHydration,
  useLlmImportDrop,
  useNodeMutations,
  useNodeSizes,
  useSelectedNodeFocus,
} from './features/llm-canvas';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { useHistory, useHistoryShortcuts } from './lib/history';
import './App.css';

type Props = { projectId: string };

export function LlmCanvas({ projectId }: Props) {
  const projectState = useProject(projectId);
  const project = projectState.status === 'ready' ? projectState.project : null;
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasTitle(projectId, projectState);

  const history = useHistory();
  useHistoryShortcuts(history);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  if (projectState.status === 'deleted') return <DeletedBanner />;

  return (
    <CanvasShell
      projectId={projectId}
      viewKey={LLM_VIEW_STORAGE_KEY}
      project={project}
      panSpeed={settings.panSpeed}
      zoomSensitivity={settings.zoomSensitivity}
      searchAriaLabel="Search steps (⌘K / Ctrl+K)"
      searchTitle="Search steps (⌘K)"
      onOpenSettings={() => setSettingsOpen(true)}
    >
      <LlmCanvasBody projectId={projectId} history={history} />

      <CanvasShell.Modals>
        <LlmCanvasModals
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          settings={settings}
          updateSetting={updateSetting}
          resetSettings={resetSettings}
          project={project ?? undefined}
          deleteProjectOpen={deleteProjectOpen}
          setDeleteProjectOpen={setDeleteProjectOpen}
        />
      </CanvasShell.Modals>
    </CanvasShell>
  );
}

type BodyProps = {
  projectId: string;
  history: ReturnType<typeof useHistory>;
};

function LlmCanvasBody({ projectId, history }: BodyProps) {
  const shell = useCanvasShell();
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;
  const {
    view,
    searchOpen,
    setSearchOpen,
    setDropError,
    setDropHandler,
    setFitBoundsGetter,
    setBackgroundPointerDown,
  } = shell;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedExample, setFocusedExample] = useState<{
    nodeId: string;
    idx: number;
    token: number;
  } | null>(null);

  const { nodes, edges, setNodes, setEdges } = useLlmHydration(projectId);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const { sizes: nodeSizes, handleMeasure } = useNodeSizes();

  const nodeMut = useNodeMutations({
    history,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
  });
  const edgeMut = useEdgeMutations({ history, edgesRef, setEdges });
  void edgeMut.remove;

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

  const { handleDrop } = useLlmImportDrop({
    projectId,
    history,
    setNodes,
    onError: setDropError,
    onCreated: setSelectedId,
  });

  useEffect(() => {
    setDropHandler(handleDrop);
    return () => setDropHandler(null);
  }, [setDropHandler, handleDrop]);

  const getFitBounds = useFitBounds(nodes, (n) => nodeSizes[n.id] ?? null);
  useEffect(() => {
    setFitBoundsGetter(getFitBounds);
    return () => setFitBoundsGetter(null);
  }, [setFitBoundsGetter, getFitBounds]);

  useEffect(() => {
    const onBackground = () => {
      setSelectedId(null);
    };
    setBackgroundPointerDown(onBackground);
    return () => setBackgroundPointerDown(null);
  }, [setBackgroundPointerDown]);

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
