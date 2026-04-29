import { useCallback } from 'react';
import type { UseHistoryReturn } from '../../../lib/history';
import { createNode, deleteNode } from '../api/nodes';
import { createEdge } from '../api/edges';
import type { EdgeRecord, NodeRecord } from '../types/canvas';
import { warn } from '../lib/warn';
import { STEP_NODE_HEIGHT } from '../lib/constants';
import type { Connecting, Naming } from './useConnectGesture';

type Args = {
  projectId: string;
  history: UseHistoryReturn;
  connecting: Connecting | null;
  naming: Naming | null;
  setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>;
  setEdges: React.Dispatch<React.SetStateAction<EdgeRecord[]>>;
  cancel: () => void;
};

/**
 * Persists a new step node + the edge from its origin port, captures
 * an undo entry that recreates with the same ids so dependent edges
 * stay valid on redo, and clears the in-flight connect/naming state.
 */
export function useCommitStep({
  projectId,
  history,
  connecting,
  naming,
  setNodes,
  setEdges,
  cancel,
}: Args) {
  return useCallback(
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

      cancel();
    },
    [naming, connecting, projectId, history, setNodes, setEdges, cancel],
  );
}
