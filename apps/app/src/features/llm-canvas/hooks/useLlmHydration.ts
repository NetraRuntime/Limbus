import { useEffect, useState } from 'react';
import { ensureStartNode, listNodes } from '../api/nodes';
import { listEdges } from '../api/edges';
import type { EdgeRecord, NodeRecord } from '../types/canvas';
import { warn } from '../lib/warn';

type State = {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  hydrated: boolean;
  setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>;
  setEdges: React.Dispatch<React.SetStateAction<EdgeRecord[]>>;
};

/**
 * Hydrates nodes + edges for `projectId` from PocketBase, ensuring a
 * singleton "start" node exists on first open.
 */
export function useLlmHydration(projectId: string): State {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [edges, setEdges] = useState<EdgeRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

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
        // ensureStartNode might create the start row a tick after listNodes was queued;
        // dedupe by id.
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

  return { nodes, edges, hydrated, setNodes, setEdges };
}
