import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasTitlebar,
  CanvasAppControlsHud,
  CanvasBottomHud,
  CanvasTopHud,
  DropErrorToast,
  InfiniteCanvas,
  getInitialView,
  useCanvasGlass,
  useCanvasTitle,
  useFitBounds,
  useViewPersist,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './features/canvas-core';
import {
  DeletedBanner,
  DeleteProjectModal,
  useProject,
  updateProject,
} from './features/projects';
import {
  EdgeOverlay,
  LLM_VIEW_STORAGE_KEY,
  Node as CanvasNode,
  NodeInspectorSidebar,
  StepNameInput,
  StepSearchPalette,
  STEP_NODE_HEIGHT,
  useCommitStep,
  useConnectGesture,
  useEdgeMutations,
  useEdgeRerouteGesture,
  useLlmHydration,
  useNodeMutations,
  useNodeSizes,
  useSelectedNodeFocus,
} from './features/llm-canvas';
import { createNode, deleteNode, updateNode } from './features/llm-canvas/api/nodes';
import {
  ImportError,
  parseConversationsFile,
} from './features/llm-canvas/lib/importExamples';
import type { NodeRecord } from './features/llm-canvas';
import { SettingsModal } from './components/SettingsModal';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { closeCurrentCanvas } from './lib/windows';
import { useHistory, useHistoryShortcuts } from './lib/history';
import './App.css';

type Props = {
  projectId: string;
};

export function LlmCanvas({ projectId }: Props) {
  const projectState = useProject(projectId);

  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>(() => getInitialView(LLM_VIEW_STORAGE_KEY));
  const [cursor, setCursor] = useState<{ worldX: number; worldY: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedExample, setFocusedExample] = useState<{
    nodeId: string;
    idx: number;
    token: number;
  } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    if (!dropError) return;
    const t = window.setTimeout(() => setDropError(null), 5000);
    return () => window.clearTimeout(t);
  }, [dropError]);

  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasTitle(projectId, projectState);
  const glass = useCanvasGlass();

  const history = useHistory();
  useHistoryShortcuts(history);

  const { nodes, edges, setNodes, setEdges } = useLlmHydration(projectId);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const { sizes: nodeSizes, handleMeasure } = useNodeSizes();

  const getFitBounds = useFitBounds(
    nodes,
    useCallback((n) => nodeSizes[n.id] ?? null, [nodeSizes]),
  );

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

  useViewPersist(LLM_VIEW_STORAGE_KEY, view);
  useSelectedNodeFocus({ canvasRef, nodesRef, nodeSizes, selectedId });

  // Cmd+K / Ctrl+K opens the step search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleBackgroundPointerDown = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleNodeSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? cur : id));
    setFocusedExample(null);
  }, []);

  const handleChange = useCallback((next: View) => setView(next), []);
  const handlePointerWorld = useCallback(
    (p: (WorldPoint & { screenX: number; screenY: number }) | null) => {
      if (!p) {
        setCursor(null);
        return;
      }
      setCursor({ worldX: p.worldX, worldY: p.worldY });
    },
    [],
  );

  // Avoid lint about an unused export until we wire an edge-remove affordance.
  void edgeMut.remove;

  const handleCanvasDrop = useCallback(
    (dt: DataTransfer, worldPoint: { worldX: number; worldY: number }) => {
      const file = dt.files?.[0];
      if (!file) return;
      setDropError(null);
      void file
        .text()
        .then(async (text) => {
          let parsed;
          try {
            parsed = parseConversationsFile(file.name, text);
          } catch (err) {
            if (err instanceof ImportError) setDropError(err.message);
            else
              setDropError(
                err instanceof Error ? err.message : 'Failed to parse file.',
              );
            return;
          }
          if (parsed.examples.length === 0) {
            setDropError('No conversations found in file.');
            return;
          }

          const baseName = file.name.replace(/\.[^.]+$/, '') || 'Imported step';
          const x = worldPoint.worldX;
          const y = worldPoint.worldY - STEP_NODE_HEIGHT / 2;

          let created: NodeRecord;
          try {
            created = await createNode({
              project: projectId,
              kind: 'step',
              name: baseName,
              x,
              y,
            });
          } catch (err) {
            setDropError(err instanceof Error ? err.message : 'Failed to create node.');
            return;
          }

          try {
            created = await updateNode(created.id, {
              examples: parsed.examples,
            });
          } catch (err) {
            setDropError(
              err instanceof Error ? err.message : 'Failed to attach examples.',
            );
            void deleteNode(created.id).catch(() => {});
            return;
          }

          setNodes((prev) => [...prev, created]);
          setSelectedId(created.id);

          const snap = created;
          const apply = () => {
            setNodes((prev) =>
              prev.some((n) => n.id === snap.id) ? prev : [...prev, snap],
            );
            void createNode({
              id: snap.id,
              project: snap.project,
              kind: 'step',
              name: snap.name,
              x: snap.x,
              y: snap.y,
            })
              .then(() => updateNode(snap.id, { examples: snap.examples }))
              .catch(() => {});
          };
          const revert = () => {
            setNodes((prev) => prev.filter((n) => n.id !== snap.id));
            void deleteNode(snap.id).catch(() => {});
          };
          history.push(
            { do: apply, undo: revert, label: `Import "${baseName}"` },
            { alreadyApplied: true },
          );
        })
        .catch((err: unknown) => {
          setDropError(err instanceof Error ? err.message : 'Failed to read file.');
        });
    },
    [projectId, setNodes, history],
  );

  const selectedNode =
    selectedId
      ? nodes.find((n) => n.id === selectedId && n.kind !== 'start') ?? null
      : null;

  // Memoised so unrelated re-renders (e.g. cursor updates from canvas
  // pointer-move) don't churn the prop reference, which would otherwise
  // re-fire the inspector's "scroll focused row into view" effect.
  const sidebarFocusedExample = useMemo(() => {
    if (!focusedExample || !selectedNode) return null;
    if (focusedExample.nodeId !== selectedNode.id) return null;
    return { idx: focusedExample.idx, token: focusedExample.token };
  }, [focusedExample, selectedNode]);

  if (projectState.status === 'deleted') return <DeletedBanner />;

  const stepNodes = nodes.filter((n) => n.kind === 'step');

  // World → screen helper for the StepNameInput overlay (lives in screen space).
  const worldToScreen = (wx: number, wy: number) => ({
    x: wx * view.scale + view.x,
    y: wy * view.scale + view.y,
  });

  return (
    <>
      <CanvasTitlebar />
      <InfiniteCanvas
        ref={canvasRef}
        initial={getInitialView(LLM_VIEW_STORAGE_KEY)}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onBackgroundPointerDown={handleBackgroundPointerDown}
        onDataTransferDrop={handleCanvasDrop}
        zoomSensitivity={settings.zoomSensitivity}
        panSpeed={settings.panSpeed}
      >
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
            onSelect={handleNodeSelect}
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
      </InfiniteCanvas>

      {naming && (() => {
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

      {selectedNode && (
        <NodeInspectorSidebar
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          onPatch={nodeMut.patch}
          focusedExample={sidebarFocusedExample}
        />
      )}

      <CanvasTopHud
        glass={glass.wordmarkGlass}
        project={projectState.status === 'ready' ? projectState.project : null}
      />

      <CanvasBottomHud
        searchPillGlass={glass.searchPillGlass}
        statusPillGlass={glass.statusPillGlass}
        controlsPillGlass={glass.controlsPillGlass}
        view={view}
        cursor={cursor as WorldPoint | null}
        canvasRef={canvasRef}
        getFitBounds={getFitBounds}
        searchAriaLabel="Search steps (⌘K / Ctrl+K)"
        searchTitle="Search steps (⌘K)"
        onSearchOpen={() => setSearchOpen(true)}
      />

      <CanvasAppControlsHud
        glass={glass.settingsPillGlass}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSetting}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
        project={projectState.status === 'ready' ? projectState.project : undefined}
        onRenameProject={
          projectState.status === 'ready'
            ? async (name) => {
                await updateProject(projectState.project.id, { name });
              }
            : undefined
        }
        onDeleteProject={() => {
          setSettingsOpen(false);
          setDeleteProjectOpen(true);
        }}
      />

      {deleteProjectOpen && projectState.status === 'ready' && (
        <DeleteProjectModal
          project={projectState.project}
          onClose={() => {
            setDeleteProjectOpen(false);
            setSettingsOpen(true);
          }}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}

      <DropErrorToast message={dropError} onDismiss={() => setDropError(null)} />

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
    </>
  );
}
