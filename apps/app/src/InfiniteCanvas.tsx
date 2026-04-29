import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import './InfiniteCanvas.css';
import { clientToWorld } from './lib/coords';

export type View = { x: number; y: number; scale: number };

export type WorldPoint = { worldX: number; worldY: number };

export type WorldRect = { x: number; y: number; width: number; height: number };

// 64× cap — WKWebView compositor blanks at extreme matrix values.
const MIN_SCALE = 1 / 64;
const MAX_SCALE = 64;
const ZOOM_INTENSITY = 0.0015;
const PINCH_ZOOM_MULTIPLIER = 4;
const LINE_TO_PX = 16;
const PAGE_TO_PX = 400;
const DEFAULT_TWEEN_MS = 420;

export type FocusOptions = {
  animate?: boolean;
  duration?: number;
  padding?: number; // fraction of viewport reserved as margin (0..1); default 0.12
  bottomInset?: number;
  /** CSS px obscured at the viewport's right edge (e.g. floating sidebar). */
  rightInset?: number;
  leftInset?: number;
  /** Cap zoom-in factor when fitting; small targets otherwise pin uncomfortably close. */
  maxScale?: number;
};

export type InfiniteCanvasHandle = {
  reset: () => void;
  zoomBy: (factor: number, anchor?: { x: number; y: number }) => void;
  getView: () => View;
  focusOn: (rect: WorldRect, opts?: FocusOptions) => void;
};


export type BackgroundPointerDown = {
  worldX: number;
  worldY: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pointerId: number;
};

type Props = {
  initial?: Partial<View>;
  onChange?: (view: View) => void;
  onPointerWorld?: (p: (WorldPoint & { screenX: number; screenY: number }) | null) => void;
  onDataTransferDrop?: (dt: DataTransfer, worldPoint: WorldPoint) => void;
  
  onBackgroundPointerDown?: (p: BackgroundPointerDown) => void;
  
  zoomSensitivity?: number;
  
  panSpeed?: number;
  children?: ReactNode;
  dotStyle?: CSSProperties;
};

const mod = (a: number, m: number) => ((a % m) + m) % m;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, Props>(function InfiniteCanvas(
  {
    initial,
    onChange,
    onPointerWorld,
    onDataTransferDrop,
    onBackgroundPointerDown,
    zoomSensitivity = PINCH_ZOOM_MULTIPLIER,
    panSpeed = 1,
    children,
    dotStyle,
  },
  ref,
) {
  const [view, setView] = useState<View>({
    x: initial?.x ?? 0,
    y: initial?.y ?? 0,
    scale: initial?.scale ?? 1,
  });
  const [dragOver, setDragOver] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomSensRef = useRef(zoomSensitivity);
  zoomSensRef.current = zoomSensitivity;
  const panSpeedRef = useRef(panSpeed);
  panSpeedRef.current = panSpeed;
  const viewRef = useRef(view);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number; pointerId: number } | null>(null);
  const tweenRaf = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const rafHandle = useRef<number | null>(null);
  const pendingView = useRef<View | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const paintView = useCallback((next: View) => {
    viewRef.current = next;
    const content = contentRef.current;
    if (content) {
      // 2D matrix avoids WKWebView's translate3d+scale blanking bug on zoom-out.
      content.style.transform = `matrix(${next.scale}, 0, 0, ${next.scale}, ${next.x}, ${next.y})`;
      content.style.setProperty('--inv-view-scale', String(1 / next.scale));
    }
    const root = containerRef.current;
    if (root) {
      const lodPower = Math.floor(Math.log2(next.scale));
      const lodScale = Math.pow(2, lodPower);
      const gridPx = 16 * (next.scale / lodScale);
      const bgX = mod(next.x, gridPx);
      const bgY = mod(next.y, gridPx);
      root.style.backgroundSize = `${gridPx}px ${gridPx}px`;
      root.style.backgroundPosition = `${bgX}px ${bgY}px`;
    }
  }, []);

  const applyView = useCallback(
    (next: View) => {
      paintView(next);
      pendingView.current = next;
      if (rafHandle.current === null) {
        rafHandle.current = requestAnimationFrame(() => {
          rafHandle.current = null;
          const v = pendingView.current;
          pendingView.current = null;
          if (v) {
            setView(v);
            onChangeRef.current?.(v);
          }
        });
      }
    },
    [paintView],
  );

  useLayoutEffect(() => {
    paintView(viewRef.current);
  }, [paintView]);

  useEffect(
    () => () => {
      if (rafHandle.current !== null) {
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = null;
      }
    },
    [],
  );

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
        applyView({
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
    [cancelTween, applyView],
  );

  const applyZoom = useCallback(
    (factor: number, ax: number, ay: number) => {
      cancelTween();
      const v = viewRef.current;
      const next = clampScale(v.scale * factor);
      if (next === v.scale) return;
      const worldX = (ax - v.x) / v.scale;
      const worldY = (ay - v.y) / v.scale;
      applyView({ scale: next, x: ax - worldX * next, y: ay - worldY * next });
    },
    [cancelTween, applyView],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pxDelta = (d: number, mode: number) => {
      if (mode === 1) return d * LINE_TO_PX;
      if (mode === 2) return d * PAGE_TO_PX;
      return d;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        const intensity = ZOOM_INTENSITY * zoomSensRef.current;
        const factor = Math.exp(-e.deltaY * intensity);
        applyZoom(factor, ax, ay);
      } else {
        const speed = panSpeedRef.current;
        const dx = pxDelta(e.deltaX, e.deltaMode) * speed;
        const dy = pxDelta(e.deltaY, e.deltaMode) * speed;
        cancelTween();
        const v = viewRef.current;
        applyView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, applyView, cancelTween]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      cancelTween();
      e.currentTarget.setPointerCapture(e.pointerId);
      panStart.current = {
        px: e.clientX,
        py: e.clientY,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
        pointerId: e.pointerId,
      };
      return;
    }
    if (e.button === 0 && onBackgroundPointerDown) {
      const rect = containerRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      const wp = rect
        ? clientToWorld(e.clientX, e.clientY, rect, v)
        : { worldX: e.clientX, worldY: e.clientY };
      onBackgroundPointerDown({
        worldX: wp.worldX,
        worldY: wp.worldY,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        pointerId: e.pointerId,
      });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect && onPointerWorld) {
      onPointerWorld(clientToWorld(e.clientX, e.clientY, rect, viewRef.current));
    }
    const start = panStart.current;
    if (!start || start.pointerId !== e.pointerId) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    const v = viewRef.current;
    applyView({ ...v, x: start.vx + dx, y: start.vy + dy });
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panStart.current?.pointerId === e.pointerId) panStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      
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
    if (!onDataTransferDrop) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wp = clientToWorld(e.clientX, e.clientY, rect, viewRef.current);
    onDataTransferDrop(e.dataTransfer, { worldX: wp.worldX, worldY: wp.worldY });
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
          applyView({ x: 0, y: 0, scale: 1 });
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
        const rightInset = Math.max(0, Math.min(opts?.rightInset ?? 0, vw * 0.8));
        const leftInset = Math.max(0, Math.min(opts?.leftInset ?? 0, vw * 0.8));
        const availW = Math.max(
          1,
          vw * (1 - padding) - rightInset - leftInset,
        );
        const availH = Math.max(1, vh * (1 - padding) - bottomInset);
        const fit = Math.min(
          availW / Math.max(1, rect.width),
          availH / Math.max(1, rect.height),
        );
        const capped = opts?.maxScale != null ? Math.min(fit, opts.maxScale) : fit;
        const scale = clampScale(capped);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const target: View = {
          scale,
          x: (vw + leftInset - rightInset) / 2 - cx * scale,
          y: (vh - bottomInset) / 2 - cy * scale,
        };
        if (opts?.animate === false) {
          cancelTween();
          applyView(target);
        } else {
          tweenTo(target, opts?.duration ?? DEFAULT_TWEEN_MS);
        }
      },
    }),
    [applyZoom, applyView, cancelTween, tweenTo],
  );

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
      style={{
        backgroundImage: 'radial-gradient(var(--dot-color) 1px, transparent 1.2px)',
        ...dotStyle,
      }}
    >
      <div
        ref={contentRef}
        className="ic-content"
        style={{ transformOrigin: '0 0' }}
      >
        {children}
      </div>
      <div className="ic-drop-outline" aria-hidden />
    </div>
  );
});
