import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import './InfiniteCanvas.css';

export type View = { x: number; y: number; scale: number };

const MIN_SCALE = 1e-4;
const MAX_SCALE = 1e4;
const ZOOM_INTENSITY = 0.0015;

export type InfiniteCanvasHandle = {
  reset: () => void;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  getView: () => View;
};

type Props = {
  initial?: Partial<View>;
  onChange?: (view: View) => void;
  onPointerWorld?: (p: { worldX: number; worldY: number; screenX: number; screenY: number } | null) => void;
  children?: ReactNode;
  dotStyle?: CSSProperties;
};

// Wrap a value into [0, m) — used so the background pattern wraps seamlessly
// while the content translation grows without bound at deep zoom.
const mod = (a: number, m: number) => ((a % m) + m) % m;

export const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, Props>(function InfiniteCanvas(
  { initial, onChange, onPointerWorld, children, dotStyle },
  ref,
) {
  const [view, setView] = useState<View>({
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    scale: initial?.scale ?? 1,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number; pointerId: number } | null>(null);

  useEffect(() => {
    onChange?.(view);
  }, [view, onChange]);

  // Apply a zoom multiplier anchored so the world point under (ax, ay) stays fixed.
  const applyZoom = useCallback((factor: number, ax: number, ay: number) => {
    setView((v) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (next === v.scale) return v;
      const worldX = (ax - v.x) / v.scale;
      const worldY = (ay - v.y) / v.scale;
      return {
        scale: next,
        x: ax - worldX * next,
        y: ay - worldY * next,
      };
    });
  }, []);

  // Wheel zoom — anchored to cursor. Registered non-passive so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      // Trackpad pinch sends ctrlKey; amplify slightly for parity with mouse wheel.
      const intensity = e.ctrlKey ? ZOOM_INTENSITY * 2 : ZOOM_INTENSITY;
      const factor = Math.exp(-e.deltaY * intensity);
      applyZoom(factor, ax, ay);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Left or middle click begins a pan. Right click reserved for future context menu.
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    panStart.current = {
      px: e.clientX,
      py: e.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect && onPointerWorld) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = viewRef.current;
      onPointerWorld({
        screenX: sx,
        screenY: sy,
        worldX: (sx - v.x) / v.scale,
        worldY: (sy - v.y) / v.scale,
      });
    }
    const start = panStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    setView((v) => ({ ...v, x: start.vx + dx, y: start.vy + dy }));
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panStart.current?.pointerId === e.pointerId) {
      panStart.current = null;
    }
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* no-op if already released */
    }
  };

  const onPointerLeave = () => onPointerWorld?.(null);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => setView({ x: 0, y: 0, scale: 1 }),
      zoomBy: (factor, anchor) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const ax = anchor?.x ?? (rect ? rect.width / 2 : 0);
        const ay = anchor?.y ?? (rect ? rect.height / 2 : 0);
        applyZoom(factor, ax, ay);
      },
      getView: () => viewRef.current,
    }),
    [applyZoom],
  );

  // Dot-grid LOD: keep the effective tile size in [16, 32) px so the texture
  // remains readable at any zoom. As zoom crosses powers of 2, the grid density
  // halves/doubles — this is what makes the canvas feel truly infinite.
  const lodPower = Math.floor(Math.log2(view.scale));
  const lodScale = Math.pow(2, lodPower);
  const gridPx = 16 * (view.scale / lodScale);
  const bgX = mod(view.x, gridPx);
  const bgY = mod(view.y, gridPx);

  return (
    <div
      ref={containerRef}
      className={`ic-root ${panStart.current ? 'ic-grabbing' : 'ic-grab'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={onPointerLeave}
      style={{
        backgroundImage: 'radial-gradient(var(--dot-color) 1px, transparent 1.2px)',
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        ...dotStyle,
      }}
    >
      <div
        className="ic-content"
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
});
