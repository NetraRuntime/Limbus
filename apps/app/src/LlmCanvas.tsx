import { useCallback, useEffect, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import {
  ProjectChip,
  DeletedBanner,
  DeleteProjectModal,
  useProject,
  updateProject,
} from './features/projects';
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  ensureStartNode,
  listEdges,
  listNodes,
  updateEdge,
  updateNode,
  type EdgeRecord,
  type NodeExample,
  type NodeRecord,
} from './features/llm-canvas';
import { SettingsModal } from './components/SettingsModal';
import { StepSearchPalette } from './components/StepSearchPalette';
import { Node as CanvasNode } from './components/Node';
import { StepNameInput } from './components/StepNameInput';
import { NodeInspectorSidebar } from './components/NodeInspectorSidebar';
import { useAutoLiquidGlassFilter } from './components/LiquidGlass';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { setCanvasTitle, closeCurrentCanvas, focusHome } from './lib/windows';
import { VIEW_PERSIST_DEBOUNCE_MS, formatCoord, formatZoom } from './lib/canvasView';
import { useHistory, useHistoryShortcuts } from './lib/history';
import { z } from 'zod';
import './App.css';

const LLM_VIEW_STORAGE_KEY = 'netrart:llm-canvas:view:v1';

// Visual approximation — step nodes are auto-sized to their text, but
// for edge anchoring we need a stable midpoint. Matches the CSS:
// 10px padding top/bottom + 14px label = ~34, rounded to 36.
const STEP_NODE_HEIGHT = 36;

const StoredViewSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
});

const readLlmStoredView = (): View | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LLM_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = StoredViewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const writeLlmStoredView = (v: View) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LLM_VIEW_STORAGE_KEY, JSON.stringify(v));
  } catch {}
};

const getLlmInitialView = (): View => {
  const stored = readLlmStoredView();
  if (stored) return stored;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2, scale: 1 };
};

const warn = (label: string, err: unknown) => {
  // ClientResponseError from pocketbase.js carries per-field validation
  // errors on `.response.data` (or sometimes `.data`). Surface those so
  // a "Failed to create record" doesn't hide the real cause.
  type PBErr = {
    message?: string;
    response?: { data?: unknown; message?: string };
    data?: unknown;
    status?: number;
  };
  const e = err as PBErr | undefined;
  console.warn(
    `[llm-canvas] ${label}`,
    e?.message ?? err,
    'status=', e?.status,
    'detail=', e?.response?.data ?? e?.data ?? null,
  );
};

type Props = {
  projectId: string;
};

export function LlmCanvas({ projectId }: Props) {
  const projectState = useProject(projectId);

  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>(() => getLlmInitialView());
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [edges, setEdges] = useState<EdgeRecord[]>([]);
  const [, setHydrated] = useState(false);
  // In-progress connection. `fromNodeId` anchors to a live node so the
  // bezier tail follows when that node moves; `toX/toY` are world
  // coords following the cursor. Cleared on pointer-up.
  const [connecting, setConnecting] = useState<{
    fromNodeId: string;
    toX: number;
    toY: number;
  } | null>(null);
  // After pointer-up of a connection drag, we keep `connecting` set so
  // the bezier stays drawn while the user names the new step. `naming`
  // holds the world drop-point used for the new step's position.
  const [naming, setNaming] = useState<{ x: number; y: number } | null>(null);
  // Measured rendered size of each node, keyed by id. Filled by Node's
  // ResizeObserver via onMeasure. Used to compute port positions.
  const [nodeSizes, setNodeSizes] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [cursor, setCursor] = useState<{ worldX: number; worldY: number } | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // In-progress edge endpoint drag. While set, the dragged end of
  // `edgeId` follows the cursor and `snapTargetId` flags a node we're
  // hovering over (visualised + used as the commit target).
  const [rerouting, setRerouting] = useState<{
    edgeId: string;
    end: 'from' | 'to';
    cursorX: number;
    cursorY: number;
    snapTargetId: string | null;
  } | null>(null);

  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);

  const history = useHistory();
  useHistoryShortcuts(history);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const settingsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const searchPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const statusPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const controlsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });

  useEffect(() => {
    if (projectState.status !== 'ready') return;
    void setCanvasTitle(projectId, projectState.project.name);
  }, [projectId, projectState]);

  // Hydrate nodes + edges from PocketBase. Ensures a singleton "start"
  // node exists for the project on first open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const start = await ensureStartNode(projectId);
        const [allNodes, allEdges] = await Promise.all([
          listNodes(projectId),
          listEdges(projectId),
        ]);
        if (cancelled) return;
        // ensureStartNode might have just created the start row a tick
        // after listNodes was queued, so dedupe by id.
        const merged = allNodes.some((n) => n.id === start.id)
          ? allNodes
          : [start, ...allNodes];
        setNodes(merged);
        setEdges(allEdges);
        setHydrated(true);
      } catch (err) {
        warn('hydrate failed', err);
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Persist the view (zoom/pan) so reopening the canvas keeps the
  // user's perspective.
  useEffect(() => {
    const t = window.setTimeout(() => writeLlmStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

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

  // Click on empty canvas deselects the current node.
  const handleBackgroundPointerDown = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleNodeSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? cur : id));
  }, []);

  // Pan/zoom the camera to bring the selected node into the unobscured
  // area (accounting for the sidebar covering the right side).
  useEffect(() => {
    if (!selectedId) return;
    const node = nodesRef.current.find((n) => n.id === selectedId);
    if (!node) return;
    const size = nodeSizes[selectedId];
    if (!size) return;
    // Read the inspector's actual width once it's mounted. The
    // sidebar mounts the same render as selection, so we wait one
    // frame so its layout is settled.
    const raf = requestAnimationFrame(() => {
      const sidebarEl = document.querySelector<HTMLElement>('.node-inspector');
      const sidebarWidth = sidebarEl
        ? sidebarEl.getBoundingClientRect().width + 24
        : 0;
      canvasRef.current?.focusOn(
        { x: node.x, y: node.y, width: size.w, height: size.h },
        { padding: 0.2, rightInset: sidebarWidth, maxScale: 1.2 },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, nodeSizes]);

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

  const handleConnectStart = useCallback(
    (fromNodeId: string, worldPoint: { x: number; y: number }) => {
      setConnecting({
        fromNodeId,
        toX: worldPoint.x,
        toY: worldPoint.y,
      });

      let lastWorld = { x: worldPoint.x, y: worldPoint.y };
      const onMove = (e: PointerEvent) => {
        const v = canvasRef.current?.getView();
        if (!v) return;
        const worldX = (e.clientX - v.x) / v.scale;
        const worldY = (e.clientY - v.y) / v.scale;
        lastWorld = { x: worldX, y: worldY };
        setConnecting((prev) =>
          prev ? { ...prev, toX: worldX, toY: worldY } : prev,
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setNaming(lastWorld);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [],
  );

  const cancelNaming = useCallback(() => {
    setNaming(null);
    setConnecting(null);
  }, []);

  const commitStep = useCallback(
    async (name: string) => {
      if (!naming) return;
      const stepX = naming.x;
      const stepY = naming.y - STEP_NODE_HEIGHT / 2;
      const fromNodeId = connecting?.fromNodeId;

      let createdNode: NodeRecord;
      try {
        createdNode = await createNode({
          project: projectId,
          kind: 'step',
          name,
          x: stepX,
          y: stepY,
        });
      } catch (err) {
        warn('create node failed', err);
        return;
      }

      let createdEdge: EdgeRecord | null = null;
      if (fromNodeId) {
        try {
          createdEdge = await createEdge({
            project: projectId,
            from_node: fromNodeId,
            to_node: createdNode.id,
          });
        } catch (err) {
          warn('create edge failed', err);
        }
      }

      setNodes((prev) => [...prev, createdNode]);
      if (createdEdge) setEdges((prev) => [...prev, createdEdge]);

      // Snapshot for undo/redo. Redo recreates with the SAME ids so
      // dependent edges (which reference the node id) stay valid.
      const nodeSnap = createdNode;
      const edgeSnap = createdEdge;
      const apply = () => {
        setNodes((prev) =>
          prev.some((n) => n.id === nodeSnap.id) ? prev : [...prev, nodeSnap],
        );
        if (edgeSnap) {
          setEdges((prev) =>
            prev.some((e) => e.id === edgeSnap.id) ? prev : [...prev, edgeSnap],
          );
        }
        void createNode({
          id: nodeSnap.id,
          project: nodeSnap.project,
          kind: 'step',
          name: nodeSnap.name,
          x: nodeSnap.x,
          y: nodeSnap.y,
        })
          .then(() => {
            if (edgeSnap) {
              return createEdge({
                id: edgeSnap.id,
                project: edgeSnap.project,
                from_node: edgeSnap.from_node,
                to_node: edgeSnap.to_node,
              });
            }
            return undefined;
          })
          .catch((err) => warn('redo create failed', err));
      };
      const revert = () => {
        setNodes((prev) => prev.filter((n) => n.id !== nodeSnap.id));
        if (edgeSnap) {
          setEdges((prev) => prev.filter((e) => e.id !== edgeSnap.id));
        }
        // DB cascade-deletes the edge when the node goes.
        void deleteNode(nodeSnap.id).catch((err) =>
          warn('undo delete failed', err),
        );
      };
      history.push(
        { do: apply, undo: revert, label: `Create step "${name}"` },
        { alreadyApplied: true },
      );

      setNaming(null);
      setConnecting(null);
    },
    [naming, connecting, projectId, history],
  );

  const handleNodeMove = useCallback(
    (id: string, next: { x: number; y: number }) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x: next.x, y: next.y } : n)),
      );
    },
    [],
  );

  const handleNodeMoveCommit = useCallback(
    (id: string, prev: { x: number; y: number }, next: { x: number; y: number }) => {
      // Drag already wrote `next` into local state via handleNodeMove;
      // persist that and register an undo swap.
      void updateNode(id, { x: next.x, y: next.y }).catch((err) =>
        warn('persist move failed', err),
      );
      const apply = () => {
        setNodes((s) =>
          s.map((n) => (n.id === id ? { ...n, x: next.x, y: next.y } : n)),
        );
        void updateNode(id, { x: next.x, y: next.y }).catch((err) =>
          warn('redo move failed', err),
        );
      };
      const revert = () => {
        setNodes((s) =>
          s.map((n) => (n.id === id ? { ...n, x: prev.x, y: prev.y } : n)),
        );
        void updateNode(id, { x: prev.x, y: prev.y }).catch((err) =>
          warn('undo move failed', err),
        );
      };
      history.push(
        { do: apply, undo: revert, label: 'Move node' },
        { alreadyApplied: true },
      );
    },
    [history],
  );

  // Per-node patch (input / output edits from the inspector). Local
  // state updates instantly, the API write is debounced per node so
  // typing fast doesn't flood PocketBase.
  const patchTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of patchTimersRef.current.values()) clearTimeout(t);
      patchTimersRef.current.clear();
    };
  }, []);

  const handleNodePatch = useCallback(
    (id: string, patch: { examples?: NodeExample[] }) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      );
      const existing = patchTimersRef.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      const timer = window.setTimeout(() => {
        patchTimersRef.current.delete(id);
        const fresh = nodesRef.current.find((n) => n.id === id);
        if (!fresh) return;
        void updateNode(id, {
          examples: fresh.examples,
        }).catch((err) => warn('persist patch failed', err));
      }, 500);
      patchTimersRef.current.set(id, timer);
    },
    [],
  );

  const handleStepRename = useCallback(
    (id: string, prevName: string, nextName: string) => {
      const apply = () => {
        setNodes((s) => s.map((n) => (n.id === id ? { ...n, name: nextName } : n)));
        void updateNode(id, { name: nextName }).catch((err) =>
          warn('rename failed', err),
        );
      };
      const revert = () => {
        setNodes((s) => s.map((n) => (n.id === id ? { ...n, name: prevName } : n)));
        void updateNode(id, { name: prevName }).catch((err) =>
          warn('undo rename failed', err),
        );
      };
      apply();
      history.push(
        { do: apply, undo: revert, label: `Rename step` },
        { alreadyApplied: true },
      );
    },
    [history],
  );

  const handleStepDelete = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.kind === 'start') return;
      const incident = edgesRef.current.filter(
        (e) => e.from_node === id || e.to_node === id,
      );
      const apply = () => {
        setNodes((s) => s.filter((n) => n.id !== id));
        setEdges((e) => e.filter((x) => x.from_node !== id && x.to_node !== id));
        // Edge rows cascade-delete from PB when the node goes.
        void deleteNode(id).catch((err) => warn('delete failed', err));
      };
      const revert = () => {
        setNodes((s) => (s.some((n) => n.id === node.id) ? s : [...s, node]));
        setEdges((e) => {
          const merged = e.slice();
          for (const inc of incident) {
            if (!merged.some((x) => x.id === inc.id)) merged.push(inc);
          }
          return merged;
        });
        void createNode({
          id: node.id,
          project: node.project,
          kind: 'step',
          name: node.name,
          x: node.x,
          y: node.y,
        })
          .then(() =>
            Promise.all(
              incident.map((inc) =>
                createEdge({
                  id: inc.id,
                  project: inc.project,
                  from_node: inc.from_node,
                  to_node: inc.to_node,
                }).catch((err) => warn('undo edge create failed', err)),
              ),
            ),
          )
          .catch((err) => warn('undo delete failed', err));
      };
      apply();
      history.push(
        { do: apply, undo: revert, label: `Delete step "${node.name}"` },
        { alreadyApplied: true },
      );
    },
    [history],
  );

  const handleEdgeReroute = useCallback(
    (
      edgeId: string,
      end: 'from' | 'to',
      newNodeId: string,
    ) => {
      const edge = edgesRef.current.find((e) => e.id === edgeId);
      if (!edge) return;
      const prevNodeId = end === 'from' ? edge.from_node : edge.to_node;
      if (prevNodeId === newNodeId) return;
      // Don't allow connecting a node to itself.
      const otherEnd = end === 'from' ? edge.to_node : edge.from_node;
      if (otherEnd === newNodeId) return;

      const apply = () => {
        setEdges((es) =>
          es.map((e) =>
            e.id === edgeId
              ? end === 'from'
                ? { ...e, from_node: newNodeId }
                : { ...e, to_node: newNodeId }
              : e,
          ),
        );
        void updateEdge(
          edgeId,
          end === 'from' ? { from_node: newNodeId } : { to_node: newNodeId },
        ).catch((err) => warn('reroute failed', err));
      };
      const revert = () => {
        setEdges((es) =>
          es.map((e) =>
            e.id === edgeId
              ? end === 'from'
                ? { ...e, from_node: prevNodeId }
                : { ...e, to_node: prevNodeId }
              : e,
          ),
        );
        void updateEdge(
          edgeId,
          end === 'from' ? { from_node: prevNodeId } : { to_node: prevNodeId },
        ).catch((err) => warn('undo reroute failed', err));
      };
      apply();
      history.push(
        { do: apply, undo: revert, label: 'Reroute edge' },
        { alreadyApplied: true },
      );
    },
    [history],
  );

  const handleEdgeEndDragStart = useCallback(
    (edgeId: string, end: 'from' | 'to', clientX: number, clientY: number) => {
      const v = canvasRef.current?.getView();
      if (!v) return;
      const wx0 = (clientX - v.x) / v.scale;
      const wy0 = (clientY - v.y) / v.scale;
      setRerouting({ edgeId, end, cursorX: wx0, cursorY: wy0, snapTargetId: null });

      // Hit-test world coords against the current node rects.
      const findNodeAt = (wx: number, wy: number): string | null => {
        for (const n of nodesRef.current) {
          const size = nodeSizes[n.id];
          if (!size) continue;
          if (
            wx >= n.x &&
            wx <= n.x + size.w &&
            wy >= n.y &&
            wy <= n.y + size.h
          ) {
            return n.id;
          }
        }
        return null;
      };

      const onMove = (ev: PointerEvent) => {
        const view = canvasRef.current?.getView();
        if (!view) return;
        const wx = (ev.clientX - view.x) / view.scale;
        const wy = (ev.clientY - view.y) / view.scale;
        const snap = findNodeAt(wx, wy);
        setRerouting((prev) =>
          prev
            ? { ...prev, cursorX: wx, cursorY: wy, snapTargetId: snap }
            : prev,
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setRerouting((prev) => {
          if (prev && prev.snapTargetId) {
            handleEdgeReroute(prev.edgeId, prev.end, prev.snapTargetId);
          }
          return null;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [nodeSizes, handleEdgeReroute],
  );

  const handleEdgeDelete = useCallback(
    (id: string) => {
      const edge = edgesRef.current.find((e) => e.id === id);
      if (!edge) return;
      const apply = () => {
        setEdges((es) => es.filter((e) => e.id !== id));
        void deleteEdge(id).catch((err) => warn('delete edge failed', err));
      };
      const revert = () => {
        setEdges((es) => (es.some((e) => e.id === edge.id) ? es : [...es, edge]));
        void createEdge({
          id: edge.id,
          project: edge.project,
          from_node: edge.from_node,
          to_node: edge.to_node,
        }).catch((err) => warn('undo edge delete failed', err));
      };
      apply();
      history.push(
        { do: apply, undo: revert, label: 'Delete edge' },
        { alreadyApplied: true },
      );
    },
    [history],
  );

  const handleMeasure = useCallback(
    (id: string, size: { width: number; height: number }) => {
      setNodeSizes((prev) => {
        const cur = prev[id];
        if (cur && cur.w === size.width && cur.h === size.height) return prev;
        return { ...prev, [id]: { w: size.width, h: size.height } };
      });
    },
    [],
  );

  // Resolve a node id to its current top-left position. Returns null if
  // the id doesn't match any current node — render code skips edges
  // pointing at vanished nodes.
  const getNodeRect = (
    nodeId: string,
  ): { x: number; y: number; w: number; h: number } | null => {
    const size = nodeSizes[nodeId];
    if (!size) return null;
    const n = nodes.find((m) => m.id === nodeId);
    if (!n) return null;
    return { x: n.x, y: n.y, w: size.w, h: size.h };
  };

  const portRight = (r: { x: number; y: number; w: number; h: number }) => ({
    x: r.x + r.w,
    y: r.y + r.h / 2,
  });
  const portLeft = (r: { x: number; y: number; w: number; h: number }) => ({
    x: r.x,
    y: r.y + r.h / 2,
  });

  // World → screen helper for the StepNameInput overlay (lives in
  // screen space).
  const worldToScreen = (wx: number, wy: number) => ({
    x: wx * view.scale + view.x,
    y: wy * view.scale + view.y,
  });

  if (projectState.status === 'deleted') return <DeletedBanner />;

  // Voiding `handleEdgeDelete` to silence the unused-var lint until we
  // wire an edge-removal affordance into the UI.
  void handleEdgeDelete;

  const stepNodes = nodes.filter((n) => n.kind === 'step');

  return (
    <>
      <div className="canvas-titlebar" data-tauri-drag-region aria-hidden />
      <InfiniteCanvas
        ref={canvasRef}
        initial={getLlmInitialView()}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onBackgroundPointerDown={handleBackgroundPointerDown}
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
              onMove={handleNodeMove}
              onMoveCommit={handleNodeMoveCommit}
              onConnectStart={(p) => handleConnectStart(n.id, p)}
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
            onMove={handleNodeMove}
            onMoveCommit={handleNodeMoveCommit}
            onRename={handleStepRename}
            onDelete={handleStepDelete}
            onConnectStart={(p) => handleConnectStart(n.id, p)}
            onMeasure={handleMeasure}
            onSelect={handleNodeSelect}
          />
        ))}
        {(connecting || edges.length > 0) && (() => {
          // Endpoint handle radius is constant in screen pixels; divide
          // by view.scale because the svg lives inside the world-
          // transformed `.ic-content`.
          const handleR = 6 / Math.max(view.scale, 1e-6);
          const handleHitR = 12 / Math.max(view.scale, 1e-6);
          return (
            <svg className="llm-edge-overlay" aria-hidden>
              {edges.map((e) => {
                const fromRect = getNodeRect(e.from_node);
                const toRect = getNodeRect(e.to_node);
                if (!fromRect || !toRect) return null;
                let a = portRight(fromRect);
                let b = portLeft(toRect);
                if (rerouting?.edgeId === e.id) {
                  const cursor = { x: rerouting.cursorX, y: rerouting.cursorY };
                  if (rerouting.end === 'from') a = cursor;
                  else b = cursor;
                }
                const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
                const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
                return (
                  <g key={e.id}>
                    <path
                      d={d}
                      className="llm-edge-path"
                      pathLength={1}
                    />
                    <circle
                      className="llm-edge-handle-hit"
                      cx={a.x}
                      cy={a.y}
                      r={handleHitR}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        handleEdgeEndDragStart(e.id, 'from', ev.clientX, ev.clientY);
                      }}
                    />
                    <circle
                      className="llm-edge-handle"
                      cx={a.x}
                      cy={a.y}
                      r={handleR}
                    />
                    <circle
                      className="llm-edge-handle-hit"
                      cx={b.x}
                      cy={b.y}
                      r={handleHitR}
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        handleEdgeEndDragStart(e.id, 'to', ev.clientX, ev.clientY);
                      }}
                    />
                    <circle
                      className="llm-edge-handle"
                      cx={b.x}
                      cy={b.y}
                      r={handleR}
                    />
                  </g>
                );
              })}
              {connecting && (() => {
                const fromRect = getNodeRect(connecting.fromNodeId);
                if (!fromRect) return null;
                const a = portRight(fromRect);
                const b = { x: connecting.toX, y: connecting.toY };
                const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
                const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
                return (
                  <path d={d} className="llm-edge-path llm-edge-path-preview" />
                );
              })()}
            </svg>
          );
        })()}
      </InfiniteCanvas>

      {naming && (() => {
        const p = worldToScreen(naming.x, naming.y);
        return (
          <StepNameInput
            anchorScreenX={p.x}
            anchorScreenY={p.y}
            onSubmit={commitStep}
            onCancel={cancelNaming}
          />
        );
      })()}

      {(() => {
        const selected = selectedId
          ? nodes.find((n) => n.id === selectedId && n.kind !== 'start') ?? null
          : null;
        if (!selected) return null;
        return (
          <NodeInspectorSidebar
            node={selected}
            onClose={() => setSelectedId(null)}
            onPatch={handleNodePatch}
          />
        );
      })()}

      <div className="hud hud-top-left">
        {wordmarkGlass.filterSvg}
        <div
          ref={wordmarkGlass.ref}
          className="wordmark is-liquid-glass"
          aria-label="NetraRT"
          style={wordmarkGlass.style}
        >
          <button
            type="button"
            className="wordmark-home"
            aria-label="Back to Home"
            title="Back to Home"
            onClick={() => void focusHome()}
          >
            <i className="ri-home-2-line wordmark-home-icon" aria-hidden />
            <span className="wordmark-glyph">NetraRT</span>
          </button>
          {projectState.status === 'ready' && (
            <>
              <span className="wordmark-divider" aria-hidden />
              <ProjectChip project={projectState.project} />
            </>
          )}
        </div>
      </div>

      <div className="hud hud-bottom-center">
        {searchPillGlass.filterSvg}
        {statusPillGlass.filterSvg}
        {controlsPillGlass.filterSvg}
        <div
          ref={searchPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Search"
          style={searchPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Search steps (⌘K / Ctrl+K)"
            title="Search steps (⌘K)"
            onClick={() => setSearchOpen(true)}
          >
            <i className="ri-search-line" aria-hidden />
          </button>
        </div>

        <div
          ref={statusPillGlass.ref}
          className="status-pill is-liquid-glass"
          style={statusPillGlass.style}
        >
          <span className="status-label">Zoom</span>
          <span className="status-value">{formatZoom(view.scale)}</span>
          <span className="status-sep" aria-hidden />
          <span className="status-label">X</span>
          <span className="status-value">{formatCoord(cursor?.worldX)}</span>
          <span className="status-label">Y</span>
          <span className="status-value">{formatCoord(cursor?.worldY)}</span>
        </div>

        <div
          ref={controlsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Canvas controls"
          style={controlsPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Fit all nodes to view"
            onClick={() => {
              // Bounds of every node on the canvas; fall back to the
              // start node alone (or a default reset) if measurements
              // haven't arrived yet.
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              let any = false;
              for (const n of nodes) {
                const size = nodeSizes[n.id];
                if (!size) continue;
                any = true;
                if (n.x < minX) minX = n.x;
                if (n.y < minY) minY = n.y;
                if (n.x + size.w > maxX) maxX = n.x + size.w;
                if (n.y + size.h > maxY) maxY = n.y + size.h;
              }
              if (!any) {
                canvasRef.current?.reset();
                return;
              }
              canvasRef.current?.focusOn(
                {
                  x: minX,
                  y: minY,
                  width: maxX - minX,
                  height: maxY - minY,
                },
                { padding: 0.12 },
              );
            }}
          >
            Reset
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.4)}
          >
            +
          </button>
        </div>
      </div>

      <div className="hud hud-top-right">
        {settingsPillGlass.filterSvg}
        <div
          ref={settingsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="App controls"
          style={settingsPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ri-settings-3-line" aria-hidden />
          </button>
        </div>
      </div>

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

      <StepSearchPalette
        open={searchOpen}
        steps={stepNodes}
        onSelect={() => setSearchOpen(false)}
        onClose={() => setSearchOpen(false)}
      />
    </>
  );
}
