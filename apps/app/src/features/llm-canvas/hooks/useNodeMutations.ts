import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { UseHistoryReturn } from '../../../lib/history';
import { createNode, deleteNode, updateNode } from '../api/nodes';
import { createEdge } from '../api/edges';
import type { EdgeRecord, NodeExample, NodeRecord } from '../types/canvas';
import { warn } from '../lib/warn';

type Args = {
  history: UseHistoryReturn;
  nodesRef: RefObject<NodeRecord[]>;
  edgesRef: RefObject<EdgeRecord[]>;
  setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>;
  setEdges: React.Dispatch<React.SetStateAction<EdgeRecord[]>>;
};

/**
 * Centralises node create/move/rename/delete/patch with optimistic
 * local updates, debounced inspector patches, and undo/redo history.
 */
export function useNodeMutations({
  history,
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
}: Args) {
  // Per-node debounce timers for inspector patches.
  const patchTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of patchTimersRef.current.values()) clearTimeout(t);
      patchTimersRef.current.clear();
    };
  }, []);

  const move = useCallback(
    (id: string, next: { x: number; y: number }) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x: next.x, y: next.y } : n)),
      );
    },
    [setNodes],
  );

  const moveCommit = useCallback(
    (
      id: string,
      prev: { x: number; y: number },
      next: { x: number; y: number },
    ) => {
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
    [history, setNodes],
  );

  const patch = useCallback(
    (id: string, patch: { examples?: NodeExample[] }) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      );
      const existing = patchTimersRef.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      const timer = window.setTimeout(() => {
        patchTimersRef.current.delete(id);
        const fresh = nodesRef.current?.find((n) => n.id === id);
        if (!fresh) return;
        void updateNode(id, { examples: fresh.examples }).catch((err) =>
          warn('persist patch failed', err),
        );
      }, 500);
      patchTimersRef.current.set(id, timer);
    },
    [nodesRef, setNodes],
  );

  const rename = useCallback(
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
        { do: apply, undo: revert, label: 'Rename step' },
        { alreadyApplied: true },
      );
    },
    [history, setNodes],
  );

  const remove = useCallback(
    (id: string) => {
      const node = nodesRef.current?.find((n) => n.id === id);
      if (!node || node.kind === 'start') return;
      const incident = (edgesRef.current ?? []).filter(
        (e) => e.from_node === id || e.to_node === id,
      );
      const apply = () => {
        setNodes((s) => s.filter((n) => n.id !== id));
        setEdges((e) => e.filter((x) => x.from_node !== id && x.to_node !== id));
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
    [history, nodesRef, edgesRef, setNodes, setEdges],
  );

  return { move, moveCommit, patch, rename, remove };
}
