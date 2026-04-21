import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import './InfiniteCanvas.css';

export type View = { x: number; y: number; scale: number };

export type WorldPoint = { worldX: number; worldY: number };

export type WorldRect = { x: number; y: number; width: number; height: number };

const MIN_SCALE = 1e-4;
const MAX_SCALE = 1e4;
const ZOOM_INTENSITY = 0.0015;
const DEFAULT_TWEEN_MS = 420;

export type FocusOptions = {
  animate?: boolean;
  duration?: number;
  padding?: number; // fraction of viewport reserved as margin (0..1); default 0.12
  // Screen-space pixels to reserve below the rect — the image fits into the
  // viewport minus this band, and is shifted upward so the rect + reserved
  // area are vertically centered as a group. Useful when a UI element (e.g.
  // the HighlightInput) sits beneath the focused image.
  bottomInset?: number;
};

export type InfiniteCanvasHandle = {
  reset: () => void;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  getView: () => View;
  focusOn: (rect: WorldRect, opts?: FocusOptions) => void;
};

type Props = {
  initial?: Partial<View>;
  onChange?: (view: View) => void;
  onPointerWorld?: (p: (WorldPoint & { screenX: number; screenY: number }) | null) => void;
  onFilesDrop?: (files: File[], worldPoint: WorldPoint) => void;
  /** Fires on a click that wasn't absorbed by a child (i.e. "background" click). */
  onBackgroundClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children?: ReactNode;
  dotStyle?: CSSProperties;
};

// Wrap a value into [0, m) so the tiled background pattern stays aligned to
// the pan translation modulo one tile.
const mod = (a: number, m: number) => ((a % m) + m) % m;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, Props>(function InfiniteCanvas(
  { initial, onChange, onPointerWorld, onFilesDrop, onBackgroundClick, children, dotStyle },
  ref,
) {
  const [view, setView] = useState<View>({
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    scale: initial?.scale ?? 1,
  });
  const [dragOver, setDragOver] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number; pointerId: number } | null>(null);
  const tweenRaf = useRef<number | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    onChange?.(view);
  }, [view, onChange]);

  const cancelTween = useCallback(() => {
    if (tweenRaf.current !== null) {
      cancelAnimationFrame(tweenRaf.current);
      tweenRaf.current = null;
    }
  }, []);

  useEffect(() => cancelTween, [cancelTween]);

  // Ease-out cubic for translation; scale uses log-lerp for perceptual linearity.
  const tweenTo = useCallback(
    (target: View, duration: number) => {
      cancelTween();
      const from = { ...viewRef.current };
      const ratio = target.scale / from.scale;
      const startedAt = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        setView({
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          scale: from.scale * Math.pow(ratio, e),
        });
        if (t < 1) {
          tweenRaf.current = requestAnimationFrame(step);
        } else {
          tweenRaf.current = null;
        }
      };
      tweenRaf.current = requestAnimationFrame(step);
    },
    [cancelTween],
  );

  const applyZoom = useCallback(
    (factor: number, ax: number, ay: number) => {
      cancelTween();
      setView((v) => {
        const next = clampScale(v.scale * factor);
        if (next === v.scale) return v;
        const worldX = (ax - v.x) / v.scale;
        const worldY = (ay - v.y) / v.scale;
        return { scale: next, x: ax - worldX * next, y: ay - worldY * next };
      });
    },
    [cancelTween],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const intensity = e.ctrlKey ? ZOOM_INTENSITY * 2 : ZOOM_INTENSITY;
      const factor = Math.exp(-e.deltaY * intensity);
      applyZoom(factor, ax, ay);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    cancelTween();
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
    if (panStart.current?.pointerId === e.pointerId) panStart.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* no-op */
    }
  };

  const onPointerLeave = () => onPointerWorld?.(null);

  // Drag-and-drop: only respond to OS file drags (not internal drags).
  const hasFiles = (e: ReactDragEvent<HTMLDivElement>) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || !onFilesDrop) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const v = viewRef.current;
    onFilesDrop(files, { worldX: (sx - v.x) / v.scale, worldY: (sy - v.y) / v.scale });
  };

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        cancelTween();
        const el = containerRef.current;
        if (el) {
          const { width, height } = el.getBoundingClientRect();
          tweenTo({ x: width / 2, y: height / 2, scale: 1 }, DEFAULT_TWEEN_MS);
        } else {
          setView({ x: 0, y: 0, scale: 1 });
        }
      },
      zoomBy: (factor, anchor) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const ax = anchor?.x ?? (rect ? rect.width / 2 : 0);
        const ay = anchor?.y ?? (rect ? rect.height / 2 : 0);
        applyZoom(factor, ax, ay);
      },
      getView: () => viewRef.current,
      focusOn: (rect, opts) => {
        const el = containerRef.current;
        if (!el) return;
        const { width: vw, height: vh } = el.getBoundingClientRect();
        const padding = opts?.padding ?? 0.12;
        const bottomInset = Math.max(0, Math.min(opts?.bottomInset ?? 0, vh * 0.8));
        const availW = Math.max(1, vw * (1 - padding));
        const availH = Math.max(1, vh * (1 - padding) - bottomInset);
        const fit = Math.min(
          availW / Math.max(1, rect.width),
          availH / Math.max(1, rect.height),
        );
        const scale = clampScale(fit);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        // Bias the image's on-screen center upward by half the inset so the
        // rect and the reserved band below it sit centered as one group.
        const target: View = {
          scale,
          x: vw / 2 - cx * scale,
          y: (vh - bottomInset) / 2 - cy * scale,
        };
        if (opts?.animate === false) {
          cancelTween();
          setView(target);
        } else {
          tweenTo(target, opts?.duration ?? DEFAULT_TWEEN_MS);
        }
      },
    }),
    [applyZoom, cancelTween, tweenTo],
  );

  const lodPower = Math.floor(Math.log2(view.scale));
  const lodScale = Math.pow(2, lodPower);
  const gridPx = 16 * (view.scale / lodScale);
  const bgX = mod(view.x, gridPx);
  const bgY = mod(view.y, gridPx);

  return (
    <div
      ref={containerRef}
      className={`ic-root ${panStart.current ? 'ic-grabbing' : 'ic-grab'} ${dragOver ? 'ic-drag-over' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={onPointerLeave}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onBackgroundClick}
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
      <div className="ic-drop-outline" aria-hidden />
    </div>
  );
});
