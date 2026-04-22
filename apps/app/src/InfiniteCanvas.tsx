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

export type View = { x: number; y: number; scale: number };

export type WorldPoint = { worldX: number; worldY: number };

export type WorldRect = { x: number; y: number; width: number; height: number };

const MIN_SCALE = 1e-4;
const MAX_SCALE = 1e4;
const ZOOM_INTENSITY = 0.0015;
// Multiplier applied to ZOOM_INTENSITY when a pinch / ctrl-wheel zoom fires.
// Pinch deltas are tiny (~1–5 per event); bumping this scales the per-event
// factor so a full pinch gesture covers a meaningful zoom range without
// feeling sluggish. Higher = more sensitive zoom.
const PINCH_ZOOM_MULTIPLIER = 4;
// Line-mode and page-mode wheel events (rare — some Firefox configs, some
// older mice) report deltas in lines/pages. Convert to approximate pixels so
// the pan speed matches pixel-mode wheel events.
const LINE_TO_PX = 16;
const PAGE_TO_PX = 400;
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

/** Info handed to parents when a left-button press lands on the canvas
 *  background (i.e. not absorbed by a media child that stops propagation).
 *  The parent decides whether the press becomes a click-to-deselect, a
 *  marquee, a drag, etc — this component doesn't own selection. */
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
  onFilesDrop?: (files: File[], worldPoint: WorldPoint) => void;
  /** Fires when left button presses on the canvas background. Parent manages
   *  any follow-up (marquee, click-to-deselect) with window-level listeners. */
  onBackgroundPointerDown?: (p: BackgroundPointerDown) => void;
  /** Pinch / ctrl-wheel zoom sensitivity multiplier (default 4). Applied as
   *  `ZOOM_INTENSITY * zoomSensitivity`. Read via a live ref inside the wheel
   *  handler so tuning the value doesn't re-attach the listener mid-gesture. */
  zoomSensitivity?: number;
  /** Pan speed multiplier for plain wheel / two-finger swipe (default 1). */
  panSpeed?: number;
  children?: ReactNode;
  dotStyle?: CSSProperties;
};

// Wrap a value into [0, m) so the tiled background pattern stays aligned to
// the pan translation modulo one tile.
const mod = (a: number, m: number) => ((a % m) + m) % m;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, Props>(function InfiniteCanvas(
  {
    initial,
    onChange,
    onPointerWorld,
    onFilesDrop,
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
  // Mirror settings in refs so the wheel listener's closure always reads the
  // latest values without needing to re-attach.
  const zoomSensRef = useRef(zoomSensitivity);
  zoomSensRef.current = zoomSensitivity;
  const panSpeedRef = useRef(panSpeed);
  panSpeedRef.current = panSpeed;
  // The imperative path (paintView below) is authoritative for the DOM's
  // transform + grid background. React state (`view`) is only read by
  // consumers (onChange + any render-time reads here); it's rAF-throttled
  // so re-renders don't gate visual responsiveness on pan/zoom.
  const viewRef = useRef(view);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number; pointerId: number } | null>(null);
  const tweenRaf = useRef<number | null>(null);
  const dragDepth = useRef(0);
  // rAF-batched state publisher. Wheel / drag events can fire faster than
  // frame rate (especially on 120Hz trackpads); if every one triggered a
  // React render through the whole subtree (Canvas + media elements), pan
  // and pinch would feel sticky. We apply the new view to the DOM
  // synchronously and coalesce the React update to at most one per frame.
  const rafHandle = useRef<number | null>(null);
  const pendingView = useRef<View | null>(null);

  useEffect(() => {
    onChange?.(view);
  }, [view, onChange]);

  // Writes the given view to the DOM: the content transform and the tiled
  // dot grid. Called on every pointer/wheel event — must be cheap and
  // allocation-free.
  const paintView = useCallback((next: View) => {
    viewRef.current = next;
    const content = contentRef.current;
    if (content) {
      content.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      // Exposed as a CSS variable so world-space overlays (e.g. media labels)
      // can counter-scale with `transform: scale(var(--inv-view-scale))` and
      // stay a constant screen size regardless of zoom.
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

  // Paint immediately; schedule a coalesced state update so consumers of
  // `view` (onChange, HUD, overlays) catch up next frame.
  const applyView = useCallback((next: View) => {
    paintView(next);
    pendingView.current = next;
    if (rafHandle.current === null) {
      rafHandle.current = requestAnimationFrame(() => {
        rafHandle.current = null;
        const v = pendingView.current;
        pendingView.current = null;
        if (v) setView(v);
      });
    }
  }, [paintView]);

  // First paint: inline styles omit transform/background-pos (because those
  // are imperative), so we must set them before the browser's first paint
  // or there'd be a one-frame flash at the identity transform.
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

  // Figma-style wheel:
  //   • ctrlKey (trackpad pinch — browser synthesizes this) → zoom at cursor
  //   • plain wheel / trackpad two-finger swipe            → pan
  // Zoom intensity and anchor math are unchanged from the pre-pan-capable
  // version — only the gating is new. A mouse user zooms by pinching the
  // trackpad OR holding Ctrl while scrolling (which also sets ctrlKey).
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
    // Middle-click drag always pans (Figma parity) — even if it lands on a
    // media child, the button check short-circuits the child's left-button
    // handler and the pan takes over.
    if (e.button === 1) {
      e.preventDefault();
      cancelTween();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      panStart.current = {
        px: e.clientX,
        py: e.clientY,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
        pointerId: e.pointerId,
      };
      return;
    }
    // Left-click on background: hand control to the parent so it can drive
    // selection (click-to-deselect, shift-click, marquee). Do NOT setPointerCapture
    // here — the parent uses window-level listeners for move/up so events
    // keep firing if the pointer leaves the viewport.
    if (e.button === 0 && onBackgroundPointerDown) {
      const rect = containerRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      const sx = rect ? e.clientX - rect.left : e.clientX;
      const sy = rect ? e.clientY - rect.top : e.clientY;
      onBackgroundPointerDown({
        worldX: (sx - v.x) / v.scale,
        worldY: (sy - v.y) / v.scale,
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
    const v = viewRef.current;
    applyView({ ...v, x: start.vx + dx, y: start.vy + dy });
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
          applyView(target);
        } else {
          tweenTo(target, opts?.duration ?? DEFAULT_TWEEN_MS);
        }
      },
    }),
    [applyZoom, applyView, cancelTween, tweenTo],
  );

  // `view` is intentionally NOT read in the render body for transform/bg —
  // those are applied imperatively by paintView to sidestep React's render
  // cycle during pan/zoom. React still re-renders (rAF-throttled) to feed
  // consumers via onChange, but the visible transform never waits for it.
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
