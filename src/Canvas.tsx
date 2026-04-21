import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import { createImage, imageFileUrl, listImages, type ImageRecord } from './lib/pb';
import { HighlightInput } from './components/HighlightInput';
import { Link } from './router';
import './App.css';

type CanvasImage = {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pending?: boolean;
};

const formatZoom = (scale: number) => {
  if (scale >= 1) return `${(scale * 100).toFixed(0)}%`;
  if (scale >= 0.01) return `${(scale * 100).toFixed(1)}%`;
  return scale.toExponential(1);
};

const formatCoord = (n: number | undefined) => {
  if (n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e5) return n.toExponential(1);
  return n.toFixed(abs < 10 ? 2 : abs < 1000 ? 1 : 0);
};

const loadImage = (file: File): Promise<{ src: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = src;
  });

const fromRecord = (r: ImageRecord): CanvasImage => ({
  id: r.id,
  src: imageFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ConnState = 'connecting' | 'ready' | 'offline';

// Delay before the hover input hides — gives the mouse a beat to bridge the
// gap from the image to the floating input without it disappearing.
const HOVER_HIDE_MS = 160;

export function Canvas() {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');

  // Highlight interaction state.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string>>({});
  const hideTimer = useRef<number | null>(null);

  const activeId = pinnedId ?? hoverId;
  const activeImage = useMemo(
    () => (activeId ? images.find((i) => i.id === activeId) ?? null : null),
    [activeId, images],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      setHoverId(null);
      hideTimer.current = null;
    }, HOVER_HIDE_MS);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  useEffect(() => {
    let cancelled = false;
    listImages()
      .then((records) => {
        if (cancelled) return;
        setImages(records.map(fromRecord));
        setConn('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[pb] failed to load images:', err);
        setConn('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape clears any pinned selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback((p: WorldPoint | null) => setCursor(p), []);

  const handleFilesDrop = useCallback(async (files: File[], point: WorldPoint) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    const loaded = await Promise.all(
      imageFiles.map(async (f) => ({ file: f, ...(await loadImage(f)) })),
    );

    const gap = 32;
    let cursorX = point.worldX - loaded[0].width / 2;
    const baseY = point.worldY - loaded[0].height / 2;

    type Draft = {
      draft: CanvasImage;
      file: File;
      meta: { x: number; y: number; width: number; height: number; name: string };
    };
    const plan: Draft[] = [];
    for (const l of loaded) {
      const meta = { x: cursorX, y: baseY, width: l.width, height: l.height, name: l.file.name };
      plan.push({
        draft: { id: uid(), src: l.src, pending: true, ...meta },
        file: l.file,
        meta,
      });
      cursorX += l.width + gap;
    }

    setImages((prev) => [...prev, ...plan.map((p) => p.draft)]);

    const minX = Math.min(...plan.map((p) => p.draft.x));
    const minY = Math.min(...plan.map((p) => p.draft.y));
    const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
    const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));
    canvasRef.current?.focusOn({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

    await Promise.all(
      plan.map(async (p) => {
        try {
          const record = await createImage(p.file, p.meta);
          setImages((prev) =>
            prev.map((img) => (img.id === p.draft.id ? fromRecord(record) : img)),
          );
          URL.revokeObjectURL(p.draft.src);
          setConn('ready');
        } catch (err) {
          console.warn('[pb] upload failed for', p.file.name, err);
          setConn('offline');
        }
      }),
    );
  }, []);

  // Click the empty canvas → release any pinned selection. The image/input
  // stop propagation of their clicks so only real background clicks reach us.
  const handleBackgroundClick = useCallback(() => {
    setPinnedId(null);
  }, []);

  const handleImageEnter = useCallback(
    (id: string) => {
      clearHideTimer();
      setHoverId(id);
    },
    [clearHideTimer],
  );

  const handleImageLeave = useCallback(() => {
    scheduleHide();
  }, [scheduleHide]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      clearHideTimer();
      setPinnedId(id);
      setHoverId(id);
    },
    [clearHideTimer],
  );

  const initial: Partial<View> = {
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    scale: 1,
  };

  const isEmpty = images.length === 0 && conn !== 'connecting';

  // Active image's screen rect — follows pan/zoom automatically since view
  // updates re-render this block.
  const activeRect = activeImage
    ? {
        x: activeImage.x * view.scale + view.x,
        y: activeImage.y * view.scale + view.y,
        width: activeImage.width * view.scale,
        height: activeImage.height * view.scale,
      }
    : null;

  return (
    <>
      <InfiniteCanvas
        ref={canvasRef}
        initial={initial}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onFilesDrop={handleFilesDrop}
        onBackgroundClick={handleBackgroundClick}
      >
        {images.map((img) => (
          <img
            key={img.id}
            src={img.src}
            alt={img.name}
            draggable={false}
            className={`world-image ${img.pending ? 'is-pending' : ''} ${img.id === activeId ? 'is-active' : ''}`}
            style={{ left: img.x, top: img.y, width: img.width, height: img.height }}
            onMouseEnter={() => handleImageEnter(img.id)}
            onMouseLeave={handleImageLeave}
            onClick={(e) => handleImageClick(e, img.id)}
          />
        ))}
      </InfiniteCanvas>

      {activeImage && activeRect && (
        <HighlightInput
          key={activeImage.id}
          rect={activeRect}
          value={highlightInputs[activeImage.id] ?? ''}
          onChange={(v) =>
            setHighlightInputs((prev) => ({ ...prev, [activeImage.id]: v }))
          }
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onFocus={() => {
            clearHideTimer();
            setPinnedId(activeImage.id);
          }}
          onBlur={() => {
            // Release the pin only if the user never typed anything.
            const v = highlightInputs[activeImage.id] ?? '';
            if (!v) setPinnedId(null);
            scheduleHide();
          }}
          onEscape={() => {
            setPinnedId(null);
            scheduleHide();
          }}
          autoFocus={pinnedId === activeImage.id}
        />
      )}

      {isEmpty && (
        <div className="empty-state" aria-hidden>
          <div className="empty-state-inner">
            <div className="empty-eyebrow">Drop to begin</div>
            <div className="empty-title">
              Drop images <span className="accent">anywhere</span>
            </div>
            <div className="empty-sub">They'll land where you drop and zoom into view.</div>
          </div>
        </div>
      )}

      <div className="hud hud-top-left">
        <div className="wordmark" aria-label="NetraRT">
          <Link to="/" className="wordmark-link">
            <span className="wordmark-glyph">NetraRT</span>
          </Link>
          <span className="wordmark-divider" aria-hidden />
          <span className="wordmark-tag">canvas</span>
          <span className="wordmark-divider" aria-hidden />
          <span className={`conn-dot conn-${conn}`} aria-label={`connection ${conn}`} />
          <span className="wordmark-tag">{conn}</span>
        </div>
      </div>

      <div className="hud hud-bottom-center">
        <div className="status-pill">
          <span className="status-label">Zoom</span>
          <span className="status-value">{formatZoom(view.scale)}</span>
          <span className="status-sep" aria-hidden />
          <span className="status-label">X</span>
          <span className="status-value">{formatCoord(cursor?.worldX)}</span>
          <span className="status-label">Y</span>
          <span className="status-value">{formatCoord(cursor?.worldY)}</span>
        </div>

        <div className="btn-cluster" role="group" aria-label="Canvas controls">
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => canvasRef.current?.reset()}
          >
            Reset
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.4)}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
}
