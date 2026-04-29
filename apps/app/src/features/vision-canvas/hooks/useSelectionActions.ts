import { useCallback, type RefObject } from 'react';
import { deleteImage, deleteVideo } from '../../../lib/pb';
import type { UseHistoryReturn } from '../../../lib/history';
import {
  deleteEntry,
  type CanvasActionMeta,
  type HistoryMedia,
} from '../../../lib/canvasHistory';
import { evictBake } from '../../segmentation';
import type { LodCache } from '../../lod';
import {
  deleteImageEncoding,
  uid,
  type CanvasMedia,
  type ConnState,
  type UploadPlan,
} from '../lib';

const DUPLICATE_OFFSET = 64;

type Args = {
  mediaRef: RefObject<CanvasMedia[]>;
  selectedIdsRef: RefObject<Set<string>>;
  setMedia: React.Dispatch<React.SetStateAction<CanvasMedia[]>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  history: UseHistoryReturn<CanvasActionMeta>;
  runUploadPlan: (plan: UploadPlan[]) => Promise<void>;
  abortUpload: (id: string) => void;
  clearSegment: (id: string) => void;
  lodCache: LodCache | null;
  dropAsset: (id: string) => void;
};

export type SelectionActions = {
  selectAll: () => void;
  duplicateSelection: () => Promise<void>;
  deleteMediaById: (id: string) => void;
  deleteSelection: () => void;
};

export function useSelectionActions({
  mediaRef,
  selectedIdsRef,
  setMedia,
  setSelectedIds,
  setLastSelectedId,
  setHoverId,
  setConn,
  history,
  runUploadPlan,
  abortUpload,
  clearSegment,
  lodCache,
  dropAsset,
}: Args): SelectionActions {
  const selectAll = useCallback(() => {
    const all = mediaRef.current ?? [];
    if (all.length === 0) return;
    setSelectedIds(new Set(all.map((m) => m.id)));
    setLastSelectedId(null);
  }, [mediaRef, setLastSelectedId, setSelectedIds]);

  const duplicateSelection = useCallback(async () => {
    const ids = selectedIdsRef.current ?? new Set<string>();
    if (ids.size === 0) return;
    const sources = (mediaRef.current ?? []).filter(
      (m) => ids.has(m.id) && !m.pending,
    );
    if (sources.length === 0) return;

    const plans = await Promise.all(
      sources.map(async (m): Promise<UploadPlan | null> => {
        try {
          const res = await fetch(m.src);
          if (!res.ok) throw new Error(`fetch ${m.name}: ${res.status}`);
          const blob = await res.blob();
          const type = blob.type || res.headers.get('content-type') || '';
          const file = new File([blob], m.name, { type });
          const src = URL.createObjectURL(blob);
          const meta = {
            x: m.x + DUPLICATE_OFFSET,
            y: m.y + DUPLICATE_OFFSET,
            width: m.width,
            height: m.height,
            name: m.name,
          };
          return {
            draft: { id: uid(), kind: m.kind, src, pending: true, ...meta },
            file,
            meta,
          };
        } catch (err) {
          console.warn('[pb] duplicate source fetch failed for', m.id, err);
          return null;
        }
      }),
    );

    const plan = plans.filter((p): p is UploadPlan => p !== null);
    if (plan.length === 0) return;

    setSelectedIds(new Set(plan.map((p) => p.draft.id)));
    setLastSelectedId(plan.length === 1 ? plan[0]!.draft.id : null);
    void runUploadPlan(plan);
  }, [
    mediaRef,
    runUploadPlan,
    selectedIdsRef,
    setLastSelectedId,
    setSelectedIds,
  ]);

  const deleteMediaById = useCallback(
    (id: string) => {
      const target = (mediaRef.current ?? []).find((m) => m.id === id);
      if (!target) return;
      setMedia((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setLastSelectedId((cur) => (cur === id ? null : cur));
      setHoverId((cur) => (cur === id ? null : cur));
      if (target.pending) {
        abortUpload(id);
        URL.revokeObjectURL(target.src);
        return;
      }
      clearSegment(id);
      const fn = target.kind === 'video' ? deleteVideo : deleteImage;
      fn(id)
        .then(() => {
          setConn('ready');
          history.push(
            deleteEntry({
              deleted: [target as HistoryMedia],
              setMedia,
              onConn: setConn,
              // Keep the SAM3 encoding cache alive during the soft-delete
              // window so undo → re-segment is instant. Drop it only when
              // the entry is evicted (history buffer overflow) and the
              // record is hard-deleted. The launch sweep is the other path;
              // it also calls deleteImageEncoding after hardDelete.
              onHardDelete: (hid, kind) => {
                if (kind === 'image') void deleteImageEncoding(hid);
              },
            }),
            { alreadyApplied: true },
          );
          if (lodCache) void lodCache.delete(id);
          evictBake(id);
          dropAsset(id);
        })
        .catch((err) => {
          console.warn('[pb] delete failed for', id, err);
          setConn('offline');
          setMedia((prev) => [...prev, target]);
        });
    },
    [
      abortUpload,
      clearSegment,
      dropAsset,
      history,
      lodCache,
      mediaRef,
      setConn,
      setHoverId,
      setLastSelectedId,
      setMedia,
      setSelectedIds,
    ],
  );

  // Batched multi-delete: one history entry covers every soft-deleted item
  // in the current selection so Cmd-Z restores them all atomically. Pending
  // uploads are aborted individually — they have no server state to undo,
  // so they don't participate in the entry. If the selection contains only
  // pending items, no entry is pushed (nothing to undo).
  const deleteSelection = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current ?? []);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const targets = (mediaRef.current ?? []).filter((m) => idSet.has(m.id));
    if (targets.length === 0) return;

    const pending = targets.filter((t) => t.pending);
    const live = targets.filter((t) => !t.pending);

    setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setLastSelectedId((cur) => (cur && idSet.has(cur) ? null : cur));
    setHoverId((cur) => (cur && idSet.has(cur) ? null : cur));

    for (const t of pending) {
      abortUpload(t.id);
      URL.revokeObjectURL(t.src);
    }
    for (const t of live) clearSegment(t.id);

    if (live.length === 0) return;

    Promise.all(
      live.map((t) =>
        (t.kind === 'video' ? deleteVideo : deleteImage)(t.id),
      ),
    )
      .then(() => {
        setConn('ready');
        history.push(
          deleteEntry({
            deleted: live as HistoryMedia[],
            setMedia,
            onConn: setConn,
            onHardDelete: (hid, kind) => {
              if (kind === 'image') void deleteImageEncoding(hid);
            },
          }),
          { alreadyApplied: true },
        );
      })
      .catch((err) => {
        console.warn('[pb] batch delete failed', err);
        setConn('offline');
        setMedia((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const restored = live.filter((t) => !have.has(t.id));
          return [...prev, ...restored];
        });
      });
  }, [
    abortUpload,
    clearSegment,
    history,
    mediaRef,
    selectedIdsRef,
    setConn,
    setHoverId,
    setLastSelectedId,
    setMedia,
    setSelectedIds,
  ]);

  return { selectAll, duplicateSelection, deleteMediaById, deleteSelection };
}
