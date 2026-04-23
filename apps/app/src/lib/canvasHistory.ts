import type { Dispatch, SetStateAction } from 'react';
import type { HistoryEntry } from './history/types';
import {
  deleteImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  restoreImage,
  restoreVideo,
  updateImagePosition,
  updateVideoPosition,
} from './pb';

// Imported from Canvas.tsx; we can't cyclically import the CanvasMedia type
// so we restate the minimal shape here. Keep fields in sync with Canvas.tsx's
// CanvasMedia — a typecheck will catch drift if anything critical changes.
export type HistoryMedia = {
  id: string;
  kind: 'image' | 'video';
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pending?: boolean;
  collectionId?: string;
  file?: string;
};

export type CanvasActionMeta =
  | { kind: 'move'; ids: string[] }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'create'; ids: string[] };

type SetMedia = Dispatch<SetStateAction<HistoryMedia[]>>;
type Conn = (c: 'ready' | 'offline') => void;
type OnHardDelete = (id: string, kind: 'image' | 'video') => void;

const applyPositions = (
  setMedia: SetMedia,
  positions: Map<string, { x: number; y: number }>,
): void => {
  setMedia((prev) =>
    prev.map((m) => {
      const p = positions.get(m.id);
      return p ? { ...m, x: p.x, y: p.y } : m;
    }),
  );
};

const persistPosition = async (
  kind: 'image' | 'video',
  id: string,
  pos: { x: number; y: number },
): Promise<void> => {
  const fn = kind === 'video' ? updateVideoPosition : updateImagePosition;
  await fn(id, pos);
};

export function moveEntry(args: {
  moves: Array<{
    id: string;
    kind: 'image' | 'video';
    from: { x: number; y: number };
    to: { x: number; y: number };
  }>;
  setMedia: SetMedia;
  onConn: Conn;
}): HistoryEntry<CanvasActionMeta> {
  const { moves, setMedia, onConn } = args;
  const ids = moves.map((m) => m.id);

  const applyAll = async (
    target: 'from' | 'to',
  ): Promise<void> => {
    const map = new Map<string, { x: number; y: number }>();
    for (const m of moves) map.set(m.id, m[target]);
    applyPositions(setMedia, map);
    try {
      await Promise.all(
        moves.map((m) => persistPosition(m.kind, m.id, m[target])),
      );
      onConn('ready');
    } catch (err) {
      onConn('offline');
      // Revert the local change so state matches PB.
      const revertMap = new Map<string, { x: number; y: number }>();
      const revertTo = target === 'to' ? 'from' : 'to';
      for (const m of moves) revertMap.set(m.id, m[revertTo]);
      applyPositions(setMedia, revertMap);
      throw err;
    }
  };

  return {
    label: `move ${ids.length} item${ids.length === 1 ? '' : 's'}`,
    meta: { kind: 'move', ids },
    do: () => applyAll('to'),
    undo: () => applyAll('from'),
  };
}

export function deleteEntry(args: {
  deleted: HistoryMedia[];
  setMedia: SetMedia;
  onConn: Conn;
  onHardDelete?: OnHardDelete;
}): HistoryEntry<CanvasActionMeta> {
  const { deleted, setMedia, onConn, onHardDelete } = args;
  const ids = deleted.map((m) => m.id);
  const idSet = new Set(ids);

  const applySoftDelete = async (): Promise<void> => {
    setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
    try {
      await Promise.all(
        deleted.map((m) =>
          (m.kind === 'video' ? deleteVideo : deleteImage)(m.id),
        ),
      );
      onConn('ready');
    } catch (err) {
      onConn('offline');
      setMedia((prev) => {
        const have = new Set(prev.map((p) => p.id));
        const restored = deleted.filter((d) => !have.has(d.id));
        return [...prev, ...restored];
      });
      throw err;
    }
  };

  const applyRestore = async (): Promise<void> => {
    setMedia((prev) => {
      const have = new Set(prev.map((p) => p.id));
      const restored = deleted.filter((d) => !have.has(d.id));
      return [...prev, ...restored];
    });
    try {
      await Promise.all(
        deleted.map((m) =>
          (m.kind === 'video' ? restoreVideo : restoreImage)(m.id),
        ),
      );
      onConn('ready');
    } catch (err) {
      onConn('offline');
      setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
      throw err;
    }
  };

  return {
    label: `delete ${ids.length} item${ids.length === 1 ? '' : 's'}`,
    meta: { kind: 'delete', ids },
    do: applySoftDelete,
    undo: applyRestore,
    onEvict: async () => {
      for (const m of deleted) {
        try {
          await (m.kind === 'video' ? hardDeleteVideo : hardDeleteImage)(m.id);
          onHardDelete?.(m.id, m.kind);
        } catch (err) {
          console.warn('[history] hard-delete failed for', m.id, err);
        }
      }
    },
  };
}

export function createEntry(args: {
  created: HistoryMedia[];
  setMedia: SetMedia;
  onConn: Conn;
}): HistoryEntry<CanvasActionMeta> {
  const { created, setMedia, onConn } = args;
  const ids = created.map((m) => m.id);
  const idSet = new Set(ids);

  const softDelete = async (): Promise<void> => {
    setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
    try {
      await Promise.all(
        created.map((m) =>
          (m.kind === 'video' ? deleteVideo : deleteImage)(m.id),
        ),
      );
      onConn('ready');
    } catch (err) {
      onConn('offline');
      setMedia((prev) => {
        const have = new Set(prev.map((p) => p.id));
        const restored = created.filter((d) => !have.has(d.id));
        return [...prev, ...restored];
      });
      throw err;
    }
  };

  const restore = async (): Promise<void> => {
    setMedia((prev) => {
      const have = new Set(prev.map((p) => p.id));
      const restored = created.filter((d) => !have.has(d.id));
      return [...prev, ...restored];
    });
    try {
      await Promise.all(
        created.map((m) =>
          (m.kind === 'video' ? restoreVideo : restoreImage)(m.id),
        ),
      );
      onConn('ready');
    } catch (err) {
      onConn('offline');
      setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
      throw err;
    }
  };

  return {
    label: `create ${ids.length} item${ids.length === 1 ? '' : 's'}`,
    meta: { kind: 'create', ids },
    // The forward action (create) has already been performed by the upload
    // path — we only need to know how to undo (soft-delete) and redo (restore).
    do: restore,
    undo: softDelete,
    // No onEvict: a create entry falling off the stack means the record was
    // successfully kept. Nothing to commit.
  };
}
