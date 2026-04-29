import { useEffect, useRef } from 'react';
import {
  hardDeleteImage,
  hardDeleteVideo,
  listTrashed,
} from '../../../lib/pb';
import { deleteImageEncoding, type ConnState } from '../lib';

const ONE_HOUR_MS = 60 * 60 * 1000;

type Args = {
  projectId: string;
  conn: ConnState;
};

/**
 * Launch-time sweep: hard-delete PB records soft-deleted more than an
 * hour ago. Catches sessions that ended before an entry could be evicted
 * from the history stack (quits, crashes, idle closes). Gated on `conn`
 * reaching a terminal state so the sweep doesn't contend with initial
 * hydration for network/main-thread time, and deferred to an idle
 * callback so it never delays first paint.
 */
export function useTrashSweep({ projectId, conn }: Args): void {
  const didSweepRef = useRef(false);

  useEffect(() => {
    if (conn === 'connecting') return;
    if (didSweepRef.current) return;
    didSweepRef.current = true;

    let cancelled = false;
    const runSweep = () => {
      void listTrashed(projectId, { olderThanMs: ONE_HOUR_MS })
        .then(({ images, videos }) => {
          if (cancelled) return;
          for (const img of images) {
            void hardDeleteImage(img.id)
              .then(() => {
                void deleteImageEncoding(img.id);
              })
              .catch((err) => {
                console.warn(
                  '[history] sweep hardDeleteImage failed',
                  img.id,
                  err,
                );
              });
          }
          for (const vid of videos) {
            void hardDeleteVideo(vid.id).catch((err) => {
              console.warn(
                '[history] sweep hardDeleteVideo failed',
                vid.id,
                err,
              );
            });
          }
        })
        .catch((err) => {
          console.warn('[history] trash sweep failed', err);
        });
    };

    let cancelSchedule: () => void;
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(runSweep);
      cancelSchedule = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(runSweep, 0);
      cancelSchedule = () => window.clearTimeout(handle);
    }

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [conn, projectId]);
}
