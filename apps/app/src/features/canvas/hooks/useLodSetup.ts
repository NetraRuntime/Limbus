import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createLodCache,
  createMipWorkerClient,
  useLodHydration,
  useLodSources,
  type LodCache,
  type MipWorkerClient,
} from '../../lod';
import type { CanvasMedia } from '../lib';

type Args = {
  paintMedia: CanvasMedia[];
  media: CanvasMedia[];
  viewScale: number;
  dpr: number;
};

export type LodSetup = {
  lodCache: LodCache | null;
  lodSources: ReturnType<typeof useLodSources>['sources'];
  priorityIds: Set<string>;
  setPriorityIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  dropAsset: (id: string) => void;
};

/**
 * Owns the LOD pipeline plumbing — cache + worker setup, source/hydration
 * derivations from `paintMedia`/`media`, and the level/asset-ready glue
 * that feeds dimensions back into the source manager and clears the
 * priority queue once an asset finishes loading.
 */
export function useLodSetup({
  paintMedia,
  media,
  viewScale,
  dpr,
}: Args): LodSetup {
  const [lodCache, setLodCache] = useState<LodCache | null>(null);
  const [lodWorker, setLodWorker] = useState<MipWorkerClient | null>(null);
  const [priorityIds, setPriorityIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    createLodCache()
      .then((c) => {
        if (!cancelled) setLodCache(c);
      })
      .catch((err) => console.warn('[lod] cache open failed', err));
    const worker = createMipWorkerClient();
    setLodWorker(worker);
    return () => {
      cancelled = true;
      worker?.terminate();
      setLodWorker(null);
    };
  }, []);

  const lodItems = useMemo(
    () =>
      paintMedia
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          src: m.src,
          width: m.width,
          height: m.height,
        })),
    [paintMedia],
  );

  const { sources: lodSources, reportLevelBlob, reportDims, dropAsset } =
    useLodSources({
      items: lodItems,
      viewScale,
      dpr,
      cache: lodCache,
    });

  const hydrationItems = useMemo(
    () =>
      media
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          src: m.src,
          priority: priorityIds.has(m.id),
        })),
    [media, priorityIds],
  );

  const handleLevelReady = useCallback(
    (e: { assetId: string; levelPx: number; blob: Blob }) => {
      reportLevelBlob(e.assetId, e.levelPx, e.blob);
    },
    [reportLevelBlob],
  );

  const handleAssetReady = useCallback(
    (id: string) => {
      setPriorityIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (lodCache) {
        void lodCache.getDims(id).then((d) => {
          if (d) reportDims(id, d.naturalWidth, d.naturalHeight);
        });
      }
    },
    [lodCache, reportDims],
  );

  useLodHydration({
    items: hydrationItems,
    cache: lodCache,
    worker: lodWorker,
    onLevelReady: handleLevelReady,
    onAssetReady: handleAssetReady,
  });

  return { lodCache, lodSources, priorityIds, setPriorityIds, dropAsset };
}
