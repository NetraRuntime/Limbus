import { useCallback, useRef, useState } from 'react';
import { InfiniteCanvas, type InfiniteCanvasHandle, type View } from './InfiniteCanvas';
import './App.css';

type CursorPos = { worldX: number; worldY: number } | null;

const formatZoom = (scale: number) => {
  if (scale >= 1) return `${(scale * 100).toFixed(0)}%`;
  if (scale >= 0.01) return `${(scale * 100).toFixed(1)}%`;
  return `${scale.toExponential(1)}`;
};

const formatCoord = (n: number | undefined) => {
  if (n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e5) return n.toExponential(1);
  return n.toFixed(abs < 10 ? 2 : abs < 1000 ? 1 : 0);
};

export function App() {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [cursor, setCursor] = useState<CursorPos>(null);

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback(
    (p: { worldX: number; worldY: number } | null) => setCursor(p),
    [],
  );

  // Center origin in the viewport on first mount so content at (0,0) is visible.
  const initial: Partial<View> = {
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    scale: 1,
  };

  return (
    <>
      <InfiniteCanvas
        ref={canvasRef}
        initial={initial}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
      >
        <div className="world-origin" aria-hidden />

        <div className="world-lockup">
          <div className="world-eyebrow">Infinite canvas</div>
          <h1 className="world-display">
            Pan. Zoom. <span className="accent">Explore.</span>
          </h1>
          <p className="world-sub">
            Drag to pan, scroll or pinch to zoom. The dot grid subdivides as you zoom in and
            rarefies as you zoom out — the surface keeps going.
          </p>
        </div>

        <div className="world-pin" style={{ left: 520, top: -40 }}>
          <span className="world-pin-dot" data-tone="success" />
          <span className="world-pin-label">Origin</span>
          <span className="world-pin-coord">0, 0</span>
        </div>

        <div className="world-pin" style={{ left: -720, top: 260 }}>
          <span className="world-pin-dot" />
          <span className="world-pin-label">Keep panning</span>
          <span className="world-pin-coord">-720, 260</span>
        </div>

        <div className="world-pin" style={{ left: 900, top: 420 }}>
          <span className="world-pin-dot" data-tone="warning" />
          <span className="world-pin-label">Zoom out to see more</span>
          <span className="world-pin-coord">900, 420</span>
        </div>

        <div className="world-pin" style={{ left: -400, top: -360 }}>
          <span className="world-pin-dot" data-tone="danger" />
          <span className="world-pin-label">Zoom in to read me</span>
          <span className="world-pin-coord">-400, -360</span>
        </div>

        <div
          className="world-pin"
          style={{ left: 2400, top: -1200, transform: 'scale(2)', transformOrigin: '0 0' }}
        >
          <span className="world-pin-dot" />
          <span className="world-pin-label">Far afield — 2.4k, -1.2k</span>
        </div>
      </InfiniteCanvas>

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

      <div className="hud hud-bottom-right">
        <div className="hint">
          <div className="hint-eyebrow">Controls</div>
          <div className="hint-row">
            <span className="hint-key">Drag</span>
            <span className="hint-desc">Pan the canvas</span>
          </div>
          <div className="hint-row">
            <span className="hint-key">Scroll / pinch</span>
            <span className="hint-desc">Zoom at cursor</span>
          </div>
          <div className="hint-row">
            <span className="hint-key">Reset</span>
            <span className="hint-desc">Return to origin</span>
          </div>
        </div>
      </div>
    </>
  );
}
