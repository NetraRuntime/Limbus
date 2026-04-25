import { useEffect, useRef } from 'react';
import { downsampleToBlob } from '../lib/captureThumbnail';
import { uploadThumbnail } from '../api/projects';
import { onCanvasCloseRequested } from '../../../lib/windows';

const PERIODIC_MS = 30_000;

type GetSourceCanvas = () => HTMLCanvasElement | null;

export function useProjectThumbnail(
  projectId: string,
  getSourceCanvas: GetSourceCanvas,
): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const capture = async (): Promise<void> => {
      if (inFlightRef.current) return;
      const source = getSourceCanvas();
      if (!source || source.width === 0 || source.height === 0) return;
      inFlightRef.current = true;
      try {
        const blob = await downsampleToBlob(source);
        if (cancelled) return;
        await uploadThumbnail(projectId, blob);
      } catch (err) {
        console.warn('[thumbnail] capture failed', err);
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = setInterval(() => void capture(), PERIODIC_MS);

    let cleanupCloseListener: (() => void) | null = null;
    onCanvasCloseRequested(async () => {
      await capture();
    })
      .then((c) => {
        cleanupCloseListener = c;
        if (cancelled) cleanupCloseListener?.();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
      cleanupCloseListener?.();
    };
  }, [projectId, getSourceCanvas]);
}
