import { useCallback, type RefObject } from 'react';
import type { UseHistoryReturn } from '../../../lib/history';
import { createEdge, deleteEdge, updateEdge } from '../api/edges';
import type { EdgeRecord } from '../types/canvas';
import { warn } from '../lib/warn';

type Args = {
  history: UseHistoryReturn;
  edgesRef: RefObject<EdgeRecord[]>;
  setEdges: React.Dispatch<React.SetStateAction<EdgeRecord[]>>;
};

/**
 * Edge create / reroute / delete with optimistic state and undo/redo.
 */
export function useEdgeMutations({ history, edgesRef, setEdges }: Args) {
  const reroute = useCallback(
    (edgeId: string, end: 'from' | 'to', newNodeId: string) => {
      const edge = edgesRef.current?.find((e) => e.id === edgeId);
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
    [edgesRef, history, setEdges],
  );

  const remove = useCallback(
    (id: string) => {
      const edge = edgesRef.current?.find((e) => e.id === id);
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
    [edgesRef, history, setEdges],
  );

  return { reroute, remove };
}
