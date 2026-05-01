import { useCallback, useEffect, useState } from 'react';
import type { UseHistoryReturn } from '../../../lib/history';
import { createNode, deleteNode, updateNode } from '../api/nodes';
import {
  ImportError,
  parseConversationsFile,
} from '../lib/importExamples';
import { STEP_NODE_HEIGHT } from '../lib/constants';
import type { NodeRecord } from '../types/canvas';

const TOAST_DURATION_MS = 5000;

type Args = {
  projectId: string;
  history: UseHistoryReturn;
  setNodes: React.Dispatch<React.SetStateAction<NodeRecord[]>>;
  onCreated?: (id: string) => void;
};

export type LlmImportDrop = {
  handleDrop: (
    dt: DataTransfer,
    worldPoint: { worldX: number; worldY: number },
  ) => void;
  dropError: string | null;
  dismissDropError: () => void;
};

export function useLlmImportDrop({
  projectId,
  history,
  setNodes,
  onCreated,
}: Args): LlmImportDrop {
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    if (!dropError) return;
    const t = window.setTimeout(() => setDropError(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [dropError]);

  const handleDrop = useCallback(
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
          onCreated?.(created.id);

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
    [projectId, setNodes, history, onCreated],
  );

  const dismissDropError = useCallback(() => setDropError(null), []);

  return { handleDrop, dropError, dismissDropError };
}
