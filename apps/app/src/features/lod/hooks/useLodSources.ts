import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_LEVEL_PX,
  type AssetKind,
  type LodSource,
  type PickedLevel,
} from '../types';
import { computeMipLevels } from '../util/mipLevels';
import { pickLevel } from '../util/pickLevel';
import type { LodCache } from '../api/lodCache';

export type VisibleItem = {
  id: string;
  kind: AssetKind;
  src: string;
  width: number; // world-space width; on-screen px = width × viewScale
  height: number;
};

export type UseLodSourcesArgs = {
  items: VisibleItem[];
  viewScale: number;
  dpr: number;
  cache: LodCache | null;
};

type Store = {
  /** Blob URLs keyed by assetId → level → url. */
  urls: Map<string, Map<number, string>>;
  /** Natural source dims discovered via hydration or preloaded from IDB. */
  dims: Map<string, { naturalWidth: number; naturalHeight: number }>;
  /** Last picked level per asset (for hysteresis). */
  lastLevel: Map<string, PickedLevel>;
};

export function useLodSources({
  items,
  viewScale,
  dpr,
  cache,
}: UseLodSourcesArgs): {
  sources: Map<string, LodSource>;
  reportLevelBlob: (assetId: string, levelPx: number, blob: Blob) => void;
  reportDims: (assetId: string, naturalWidth: number, naturalHeight: number) => void;
  dropAsset: (assetId: string) => void;
} {
  const [renderTick, forceRender] = useState(0);
  const store = useRef<Store>({
    urls: new Map(),
    dims: new Map(),
    lastLevel: new Map(),
  });

  const bump = useCallback(() => forceRender((n) => n + 1), []);

  const reportLevelBlob = useCallback(
    (assetId: string, levelPx: number, blob: Blob) => {
      const assetMap = store.current.urls.get(assetId) ?? new Map();
      const prior = assetMap.get(levelPx);
      if (prior) URL.revokeObjectURL(prior);
      assetMap.set(levelPx, URL.createObjectURL(blob));
      store.current.urls.set(assetId, assetMap);
      bump();
    },
    [bump],
  );

  const reportDims = useCallback(
    (assetId: string, naturalWidth: number, naturalHeight: number) => {
      store.current.dims.set(assetId, { naturalWidth, naturalHeight });
      bump();
    },
    [bump],
  );

  const dropAsset = useCallback(
    (assetId: string) => {
      const assetMap = store.current.urls.get(assetId);
      if (assetMap) {
        for (const url of assetMap.values()) URL.revokeObjectURL(url);
        store.current.urls.delete(assetId);
      }
      store.current.dims.delete(assetId);
      store.current.lastLevel.delete(assetId);
      bump();
    },
    [bump],
  );

  useEffect(() => {
    if (!cache) return;
    let cancelled = false;
    (async () => {
      for (const item of items) {
        if (cancelled) return;
        if (!store.current.dims.has(item.id)) {
          const d = await cache.getDims(item.id);
          if (cancelled) return;
          if (d) store.current.dims.set(item.id, d);
        }
        const assetUrls = store.current.urls.get(item.id) ?? new Map<number, string>();
        if (!assetUrls.has(64)) {
          const entry = await cache.get(item.id, 64);
          if (cancelled) return;
          if (entry) {
            assetUrls.set(64, URL.createObjectURL(entry.blob));
            store.current.urls.set(item.id, assetUrls);
          }
        }
      }
      if (!cancelled) bump();
    })();
    return () => {
      cancelled = true;
    };
  }, [items, cache, bump]);

  const sources = useMemo(() => {
    const out = new Map<string, LodSource>();
    for (const item of items) {
      const onScreenPx = Math.max(item.width, item.height) * viewScale;
      const dims = store.current.dims.get(item.id);
      const levels = dims
        ? computeMipLevels(Math.max(dims.naturalWidth, dims.naturalHeight))
        : [];
      const prev = store.current.lastLevel.get(item.id);
      const picked = pickLevel(levels, onScreenPx, dpr, prev);
      store.current.lastLevel.set(item.id, picked);

      const assetUrls = store.current.urls.get(item.id);
      let lodSrc: string | undefined;
      if (picked !== 'full' && assetUrls) {
        lodSrc = assetUrls.get(picked);
        if (!lodSrc) {
          if (cache) void loadLevelInBackground(cache, item.id, picked, reportLevelBlob);
        }
      }

      const playVideo =
        item.kind === 'video' && onScreenPx > MAX_LEVEL_PX;
      const final: LodSource = lodSrc
        ? { lodSrc, isFallback: false, playVideo }
        : { lodSrc: item.src, isFallback: true, playVideo };
      out.set(item.id, final);
    }
    return out;
  }, [items, viewScale, dpr, cache, reportLevelBlob, renderTick]);

  return { sources, reportLevelBlob, reportDims, dropAsset };
}

async function loadLevelInBackground(
  cache: LodCache,
  assetId: string,
  levelPx: number,
  report: (assetId: string, levelPx: number, blob: Blob) => void,
): Promise<void> {
  const entry = await cache.get(assetId, levelPx);
  if (entry) report(assetId, levelPx, entry.blob);
}
