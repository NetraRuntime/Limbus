import { useEffect, useRef, type RefObject } from 'react';
import {
  listImages,
  listSegmentations,
  listVideos,
  type ImageRecord,
  type SegmentationRecord,
  type VideoRecord,
} from '../../../lib/pb';
import { groupSegmentationsByImage } from '../../../lib/segmentations';
import type { InfiniteCanvasHandle } from '../../../InfiniteCanvas';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  fromImageRecord,
  fromVideoRecord,
  mediaBounds,
  type CanvasMedia,
  type ConnState,
  type SegmentState,
} from '../lib';

const RETRY_MS = 500;

type Args = {
  projectId: string;
  canvasRef: RefObject<InfiniteCanvasHandle>;
  initialHadStoredView: RefObject<boolean>;
  /** Owned by the caller so consumers (stack-order sync) can gate on it. */
  initialMediaLoadedRef: React.MutableRefObject<boolean>;
  setMedia: React.Dispatch<React.SetStateAction<CanvasMedia[]>>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
};

/**
 * Loads images/videos/segmentations for the project, retrying every
 * RETRY_MS until at least one list succeeds — `tauri dev` starts Vite
 * before the Rust binary boots PocketBase, so first fetches typically
 * race and hit ECONNREFUSED. PB is local, so polling is cheap and the
 * user only sees 'offline' for a few hundred ms after PB is reachable.
 */
export function useCanvasHydration({
  projectId,
  canvasRef,
  initialHadStoredView,
  initialMediaLoadedRef,
  setMedia,
  setSegments,
  setConn,
}: Args): void {
  const didInitialFitRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let loaded = false;
    const load = () => {
      void Promise.all([
        listImages(projectId).then(
          (r) => ({ ok: true as const, records: r }),
          (err) => {
            console.warn('[pb] failed to load images:', err);
            return { ok: false as const, records: [] as ImageRecord[] };
          },
        ),
        listVideos(projectId).then(
          (r) => ({ ok: true as const, records: r }),
          (err) => {
            console.warn('[pb] failed to load videos:', err);
            return { ok: false as const, records: [] as VideoRecord[] };
          },
        ),
        listSegmentations(projectId).then(
          (r) => r,
          (err) => {
            console.warn('[pb] failed to load segmentations:', err);
            return [] as SegmentationRecord[];
          },
        ),
      ]).then(([imgRes, vidRes, segRows]) => {
        if (cancelled) return;
        const anyOk = imgRes.ok || vidRes.ok;
        if (!anyOk) {
          setConn('offline');
          retryTimer = window.setTimeout(load, RETRY_MS);
          return;
        }
        if (loaded) return;
        loaded = true;
        const merged: CanvasMedia[] = [
          ...imgRes.records.map(fromImageRecord),
          ...vidRes.records.map(fromVideoRecord),
        ];
        merged.sort((a, b) => a.id.localeCompare(b.id));
        setMedia(merged);

        const grouped = groupSegmentationsByImage(segRows);
        if (grouped.size > 0) {
          const initial: Record<string, SegmentState> = {};
          for (const [imageId, rows] of grouped) {
            initial[imageId] = {
              entries: rows.map((r) => ({
                tag: r.tag,
                status: 'ready' as const,
                response: {
                  masks: r.masks,
                  source_width: r.source_width,
                  source_height: r.source_height,
                },
              })),
            };
          }
          setSegments((prev) => ({ ...initial, ...prev }));
        }
        initialMediaLoadedRef.current = true;
        setConn('ready');

        if (
          !initialHadStoredView.current &&
          !didInitialFitRef.current &&
          merged.length > 0
        ) {
          const bounds = mediaBounds(merged);
          if (bounds) {
            didInitialFitRef.current = true;
            requestAnimationFrame(() => {
              canvasRef.current?.focusOn(bounds, {
                animate: false,
                bottomInset: HIGHLIGHT_BOTTOM_INSET_PX,
              });
            });
          }
        }
      });
    };
    load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  void didInitialFitRef;
}
