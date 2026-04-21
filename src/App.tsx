import { useCallback, useEffect, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import './App.css';

type CanvasImage = {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

// Load a File as an object URL and resolve with its natural dimensions so we
// know how big to render it in world space before adding it to the scene.
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

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function App() {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [images, setImages] = useState<CanvasImage[]>([]);

  // Release object URLs on unmount to avoid leaks.
  useEffect(
    () => () => {
      images.forEach((i) => URL.revokeObjectURL(i.src));
    },
    // intentionally empty — only run the cleanup once on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback((p: WorldPoint | null) => setCursor(p), []);

  const handleFilesDrop = useCallback(async (files: File[], point: WorldPoint) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    // Load all in parallel; lay them out horizontally starting from the drop
    // point so dropping a batch doesn't stack images on top of each other.
    const loaded = await Promise.all(
      imageFiles.map(async (f) => ({ file: f, ...(await loadImage(f)) })),
    );

    const gap = 32;
    const additions: CanvasImage[] = [];
    let cursorX = point.worldX - loaded[0].width / 2;
    const baseY = point.worldY - loaded[0].height / 2;
    for (const l of loaded) {
      additions.push({
        id: uid(),
        src: l.src,
        name: l.file.name,
        x: cursorX,
        y: baseY,
        width: l.width,
        height: l.height,
      });
      cursorX += l.width + gap;
    }

    setImages((prev) => [...prev, ...additions]);

    // Focus on the full bounding box of the newly dropped batch.
    const minX = Math.min(...additions.map((a) => a.x));
    const minY = Math.min(...additions.map((a) => a.y));
    const maxX = Math.max(...additions.map((a) => a.x + a.width));
    const maxY = Math.max(...additions.map((a) => a.y + a.height));
    canvasRef.current?.focusOn({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }, []);

  const initial: Partial<View> = {
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    scale: 1,
  };

  const isEmpty = images.length === 0;

  return (
    <>
      <InfiniteCanvas
        ref={canvasRef}
        initial={initial}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onFilesDrop={handleFilesDrop}
      >
        {images.map((img) => (
          <img
            key={img.id}
            src={img.src}
            alt={img.name}
            draggable={false}
            className="world-image"
            style={{
              left: img.x,
              top: img.y,
              width: img.width,
              height: img.height,
            }}
          />
        ))}
      </InfiniteCanvas>

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
        <div className="wordmark" aria-label="Netrart">
          <span className="wordmark-glyph">netrart</span>
          <span className="wordmark-divider" aria-hidden />
          <span className="wordmark-tag">infinite canvas</span>
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
