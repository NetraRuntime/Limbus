import { useEffect, useRef } from 'react';
import type { AssetKind } from '../types';
import { computeMipLevels } from '../util/mipLevels';
import { sourceBitmap } from '../util/sourceBitmap';
import type { LodCache } from '../api/lodCache';
import type { MipWorkerClient } from '../worker/mipWorkerClient';

export type HydrationItem = {
  id: string;
  kind: AssetKind;
  src: string;
  /** When true, skip the idle-queue wait (used for fresh uploads). */
  priority?: boolean;
};

export type LevelReadyCallback = (e: {
  assetId: string;
  levelPx: number;
  blob: Blob;
}) => void;

export type UseLodHydrationArgs = {
  items: HydrationItem[];
  cache: LodCache | null;
  worker: MipWorkerClient | null;
  onLevelReady: LevelReadyCallback;
  /** Called once per asset when generation finishes (success or disabled). */
  onAssetReady?: (assetId: string) => void;
};

type Queue = {
  priority: HydrationItem[];
  idle: HydrationItem[];
};

const schedule = (cb: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: IdleRequestCallback) => number })
    .requestIdleCallback;
  if (ric) ric(() => cb());
  else setTimeout(cb, 0);
};

export function useLodHydration({
  items,
  cache,
  worker,
  onLevelReady,
  onAssetReady,
}: UseLodHydrationArgs): void {
  const pending = useRef<Set<string>>(new Set());
  const hydrated = useRef<Set<string>>(new Set());
  const disabled = useRef<Set<string>>(new Set());
  const queue = useRef<Queue>({ priority: [], idle: [] });
  const running = useRef(false);
  const onLevelRef = useRef(onLevelReady);
  onLevelRef.current = onLevelReady;
  const onAssetRef = useRef(onAssetReady);
  onAssetRef.current = onAssetReady;

  useEffect(() => {
    if (!cache || !worker) return;
    let cancelled = false;

    const processOne = async (): Promise<void> => {
      if (cancelled) return;
      const next = queue.current.priority.shift() ?? queue.current.idle.shift();
      if (!next) {
        running.current = false;
        return;
      }
      pending.current.delete(next.id);
      if (hydrated.current.has(next.id) || disabled.current.has(next.id)) {
        void processOne();
        return;
      }
      try {
        const { bitmap, width, height } = await sourceBitmap(next.kind, next.src);
        const longest = Math.max(width, height);
        const levels = computeMipLevels(longest);
        if (!levels.length) {
          disabled.current.add(next.id);
          bitmap.close?.();
          onAssetRef.current?.(next.id);
          void processOne();
          return;
        }
        await cache.putDims(next.id, width, height);
        const handle = worker.generate({
          assetId: next.id,
          kind: next.kind,
          bitmap,
          levels,
        });
        handle.onLevel(async (evt) => {
          await cache.put(evt.assetId, evt.levelPx, next.kind, evt.blob);
          onLevelRef.current({
            assetId: evt.assetId,
            levelPx: evt.levelPx,
            blob: evt.blob,
          });
        });
        await handle.done;
        hydrated.current.add(next.id);
        onAssetRef.current?.(next.id);
      } catch (err) {
        console.warn('[lod] hydration failed for', next.id, err);
        disabled.current.add(next.id);
        onAssetRef.current?.(next.id);
      }
      void processOne();
    };

    const pump = (): void => {
      if (running.current) return;
      running.current = true;
      void processOne();
    };

    const enqueue = async (item: HydrationItem): Promise<void> => {
      if (
        hydrated.current.has(item.id) ||
        pending.current.has(item.id) ||
        disabled.current.has(item.id)
      )
        return;
      const has = await cache.has(item.id, 64);
      if (cancelled) return;
      if (has) {
        hydrated.current.add(item.id);
        return;
      }
      pending.current.add(item.id);
      if (item.priority) queue.current.priority.push(item);
      else queue.current.idle.push(item);
      if (item.priority) pump();
      else schedule(pump);
    };

    items.forEach((item) => {
      void enqueue(item);
    });

    return () => {
      cancelled = true;
    };
  }, [items, cache, worker]);
}
