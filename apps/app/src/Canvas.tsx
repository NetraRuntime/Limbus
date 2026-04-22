import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type BackgroundPointerDown,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from './InfiniteCanvas';
import {
  createImage,
  createVideo,
  deleteImage,
  deleteVideo,
  imageFileUrl,
  listImages,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type VideoRecord,
} from './lib/pb';
import {
  HighlightInput,
  HIGHLIGHT_INPUT_GAP,
  HIGHLIGHT_INPUT_HEIGHT,
} from './components/HighlightInput';
import { FloatingSidebar } from './components/FloatingSidebar';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { SettingsModal } from './components/SettingsModal';
import { SearchPalette, type SearchItem } from './components/SearchPalette';
import { useSettings } from './hooks/useSettings';
import './App.css';

type CanvasMedia = {
  id: string;
  kind: MediaKind;
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

// Probe a video file for its intrinsic dimensions without decoding a frame.
// Resolves once `loadedmetadata` fires, which is enough to get videoWidth /
// videoHeight reliably across browsers.
const loadVideo = (file: File): Promise<{ src: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;
    vid.onloadedmetadata = () => {
      const w = vid.videoWidth || 640;
      const h = vid.videoHeight || 360;
      resolve({ src, width: w, height: h });
    };
    vid.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${file.name}`));
    };
    vid.src = src;
  });

const fromImageRecord = (r: ImageRecord): CanvasMedia => ({
  id: r.id,
  kind: 'image',
  src: imageFileUrl(r),
  name: r.name,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
});

const fromVideoRecord = (r: VideoRecord): CanvasMedia => ({
  id: r.id,
  kind: 'video',
  src: videoFileUrl(r),
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
// gap from the media to the floating input without it disappearing.
const HOVER_HIDE_MS = 160;
// Pixels of pointer movement (in screen space) before a press-and-drag on a
// media element is treated as a move. Below the threshold the interaction
// falls through to click / double-click as usual.
const DRAG_THRESHOLD_PX = 4;

type DragOrig = { x: number; y: number; kind: MediaKind };

type DragState = {
  // The media the pointer came down on. Used to gate click semantics so a
  // shift+click followed by a drag-cancel (moved === false) still toggles
  // the correct id.
  anchorId: string;
  pointerId: number;
  startX: number;
  startY: number;
  // Every id being moved, mapped to its pre-drag position + kind. Multi-drag
  // populates this with the entire selection; single-drag has one entry.
  orig: Map<string, DragOrig>;
  moved: boolean;
  lastDx: number;
  lastDy: number;
};

type MarqueeState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  // Selection BEFORE the marquee started — used to compute additive selection
  // as (baseSet ∪ insideMarquee) on shift-drag.
  baseSet: Set<string>;
  additive: boolean;
  moved: boolean;
};

type UploadPhase = 'sending' | 'finalizing' | 'error';
type UploadStatus = { phase: UploadPhase; pct: number; message?: string };

// localStorage key for the cached viewport. `:v1` is a schema suffix so we
// can invalidate old cache payloads if the View shape ever changes.
const VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';
// Debounce window for persisting view changes — pan/zoom emits many frames,
// so we wait for the motion to settle before writing.
const VIEW_PERSIST_DEBOUNCE_MS = 200;

// Occlusion culling: render only media whose world-space AABB intersects the
// viewport plus this margin on each side (expressed as a fraction of the
// viewport). A larger buffer mounts more off-screen items but makes pan
// smoother by hiding the mount/unmount boundary — 0.5 keeps ~4x the viewport
// area in the DOM, which trades a little memory for zero pop-in on brisk pans.
const CULL_BUFFER_FACTOR = 0.5;

const readStoredView = (): View | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      Number.isFinite(parsed.x) &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.y) &&
      typeof parsed.scale === 'number' &&
      Number.isFinite(parsed.scale) &&
      parsed.scale > 0
    ) {
      return { x: parsed.x, y: parsed.y, scale: parsed.scale };
    }
  } catch {
    /* corrupt payload — fall through to fresh defaults */
  }
  return null;
};

const writeStoredView = (v: View) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage full / private mode — silently skip */
  }
};

// Bounding rect (world coords) that covers every media item. Null when the
// collection is empty — callers fall back to whatever default view they had.
const mediaBounds = (items: CanvasMedia[]): WorldRect | null => {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of items) {
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    const rx = m.x + m.width;
    const ry = m.y + m.height;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

type MediaPointerEvent = React.PointerEvent<HTMLImageElement | HTMLVideoElement>;

// Memoized media renderer. Canvas re-renders on every rAF-paced view update
// (to position marquee/pending/HighlightInput overlays), so each media
// element would otherwise reconcile ~60×/sec — including for items that
// haven't moved or been selected/hovered. React.memo + stable handler refs
// + stable per-item references (see setMedia in pointermove: untouched
// items preserve their prior reference) keep the per-frame cost near zero
// for off-selection, non-dragged items.
type MediaItemProps = {
  m: CanvasMedia;
  isActive: boolean;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, m: CanvasMedia) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};

const MediaItem = memo(function MediaItem({
  m,
  isActive,
  onEnter,
  onLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MediaItemProps) {
  const cls = `world-image ${m.pending ? 'is-pending' : ''} ${isActive ? 'is-active' : ''}`;
  const style = { left: m.x, top: m.y, width: m.width, height: m.height };
  const handleEnter = () => onEnter(m.id);
  const handleClick = (e: React.MouseEvent) => onClick(e, m.id);
  const handleDouble = (e: React.MouseEvent) => onDoubleClick(e, m);
  const handleContext = (e: React.MouseEvent) => onContextMenu(e, m.id);
  const handleDown = (e: MediaPointerEvent) => onPointerDown(e, m);

  const label = (
    // Anchored at the media's top-left world coord. Counter-scales (via the
    // --inv-view-scale CSS variable set by InfiniteCanvas's paintView) so it
    // keeps a constant screen-size at any zoom. pointer-events:none so it
    // never hijacks drag/click — handlers stay on the img/video underneath.
    <span className="media-label" style={{ left: m.x, top: m.y }}>
      {m.name}
    </span>
  );

  if (m.kind === 'video') {
    return (
      <>
        <video
          src={m.src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className={cls}
          style={style}
          onMouseEnter={handleEnter}
          onMouseLeave={onLeave}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onContextMenu={handleContext}
          onPointerDown={handleDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {label}
      </>
    );
  }
  return (
    <>
      <img
        src={m.src}
        alt={m.name}
        draggable={false}
        className={cls}
        style={style}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        onClick={handleClick}
        onDoubleClick={handleDouble}
        onContextMenu={handleContext}
        onPointerDown={handleDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {label}
    </>
  );
});

// Compute the starting view once at module load. Pulled out of the component
// so the useState initializer and the `initial` prop share a single source
// of truth — prevents a one-frame flicker where the two get out of sync.
const getInitialView = (): View => {
  const stored = readStoredView();
  if (stored) return stored;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2, scale: 1 };
};

export function Canvas() {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  // Captures whether a saved view existed at the moment the canvas mounted.
  // Used to gate the auto-fit below: when the user already has a deliberate
  // camera from a prior session, we leave it alone; when they don't (first
  // visit, or localStorage cleared), we fit all media into the viewport
  // once loading settles.
  const initialHadStoredView = useRef<boolean>(readStoredView() !== null);
  // Latches after the one-shot auto-fit so later media changes (uploads,
  // deletes) don't keep snapping the view around.
  const didInitialFitRef = useRef<boolean>(false);
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  // Upload status per pending media id. Two-phase state:
  //   phase 'sending'    → body in flight, pct ∈ [0, 1)
  //   phase 'finalizing' → body fully sent, waiting for PB to return record
  // Keeping phase + pct in ONE state entry (instead of deriving phase from
  // pct) avoids a window where progress events race with render such that
  // the chip briefly falls back to the "Uploading" placeholder.
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  // In-flight upload AbortControllers, keyed by draft id. A delete on a
  // pending media aborts the XHR so the server doesn't end up with a ghost
  // record referencing a file the user never meant to keep.
  const uploadCtrlsRef = useRef<Record<string, AbortController>>({});

  // Highlight interaction state.
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Multi-selection. Shift+click toggles membership; plain click replaces
  // with a single-element set; marquee commits a rect-intersected set.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The id most recently added to the selection. Used to anchor the
  // HighlightInput when selection.size === 1. When selection is empty we
  // fall back to hoverId so the current-hover UX still works.
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string>>({});
  const hideTimer = useRef<number | null>(null);
  // Live marquee — when non-null, a selection rectangle is being dragged out.
  // Stored as world coords so it stays anchored to content under pan/zoom.
  const [marqueeRect, setMarqueeRect] = useState<{
    minX: number; minY: number; maxX: number; maxY: number;
  } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  // Right-click context menu state. `id` identifies the media under the
  // cursor; `x`/`y` are viewport coordinates for the menu anchor.
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Drag-to-move state. Kept in a ref so pointermove handlers don't force a
  // re-render per frame; position updates go through setMedia.
  const dragRef = useRef<DragState | null>(null);
  // Set when a shift-press toggled selection in pointerdown, so the click
  // that follows knows not to re-toggle (and so an unreliable "click" event
  // — browsers sometimes suppress click when the gesture doesn't meet their
  // threshold — never causes the toggle to be missed in the first place).
  const shiftToggledRef = useRef(false);
  // Mirror of the live view so pointermove can read the current scale without
  // forcing handler re-creation on every view change.
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  // Items visually rendered with the selection outline ("is-active"). This is
  // a superset of selectedIds: during a marquee we also preview the items the
  // rect would select (union with base for shift-drag, just the inside set
  // for plain drag). Hover falls through only when nothing is selected.
  const marqueeInside = useMemo(() => {
    if (!marqueeRect) return null;
    const inside = new Set<string>();
    for (const m of media) {
      if (
        m.x + m.width >= marqueeRect.minX &&
        m.x <= marqueeRect.maxX &&
        m.y + m.height >= marqueeRect.minY &&
        m.y <= marqueeRect.maxY
      ) {
        inside.add(m.id);
      }
    }
    return inside;
  }, [marqueeRect, media]);

  const activeSet = useMemo<Set<string>>(() => {
    if (marqueeInside && marqueeRef.current) {
      const s = new Set(marqueeRef.current.additive ? marqueeRef.current.baseSet : []);
      for (const id of marqueeInside) s.add(id);
      return s;
    }
    if (selectedIds.size > 0) return selectedIds;
    if (hoverId) return new Set([hoverId]);
    return new Set();
  }, [selectedIds, hoverId, marqueeInside]);

  // HighlightInput anchors to a single item. Show only when exactly one item
  // is selected (or, when nothing is selected, the hovered item). A multi-
  // selection suppresses the input to avoid ambiguity about which item it
  // would operate on.
  const activeId = useMemo<string | null>(() => {
    if (marqueeRef.current) return null;
    if (selectedIds.size === 1) return lastSelectedId ?? Array.from(selectedIds)[0] ?? null;
    if (selectedIds.size === 0) return hoverId;
    return null;
  }, [selectedIds, hoverId, lastSelectedId]);

  const activeMedia = useMemo(
    () => (activeId ? media.find((m) => m.id === activeId) ?? null : null),
    [activeId, media],
  );

  // Union AABB of the currently-selected items in world space. Only computed
  // when 2+ items are selected — a single selection already shows its outline
  // via the is-active class, so an extra frame around it would be redundant.
  const selectionBBox = useMemo(() => {
    if (selectedIds.size < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of media) {
      if (!selectedIds.has(m.id)) continue;
      if (m.x < minX) minX = m.x;
      if (m.y < minY) minY = m.y;
      if (m.x + m.width > maxX) maxX = m.x + m.width;
      if (m.y + m.height > maxY) maxY = m.y + m.height;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }, [selectedIds, media]);

  // Track window dimensions for viewport culling. The canvas is
  // position:fixed; inset:0, so window size === viewport size.
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Occlusion culling. Drop media whose AABB lies entirely outside the
  // viewport (plus a generous buffer) so they're removed from the DOM and
  // don't pay decode/paint cost. Never cull items that are part of an active
  // interaction — the hovered item, any selected item, or any item currently
  // being dragged — otherwise the HighlightInput's anchor disappears or the
  // drag target gets ripped out from under the pointer.
  const visibleMedia = useMemo(() => {
    if (!viewport.w || !viewport.h || !media.length) return media;
    const padX = viewport.w * CULL_BUFFER_FACTOR;
    const padY = viewport.h * CULL_BUFFER_FACTOR;
    const minX = (-view.x - padX) / view.scale;
    const minY = (-view.y - padY) / view.scale;
    const maxX = (viewport.w - view.x + padX) / view.scale;
    const maxY = (viewport.h - view.y + padY) / view.scale;
    const draggingIds = dragRef.current?.orig;
    return media.filter((m) => {
      if (selectedIds.has(m.id) || m.id === hoverId) return true;
      if (draggingIds && draggingIds.has(m.id)) return true;
      return (
        m.x + m.width >= minX &&
        m.y + m.height >= minY &&
        m.x <= maxX &&
        m.y <= maxY
      );
    });
  }, [media, view, viewport, selectedIds, hoverId]);

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

  // Persist the camera (pan + zoom) after motion settles so the next session
  // starts where the user left off. Debounced so pan/zoom tweens don't spam
  // localStorage writes on every animation frame.
  useEffect(() => {
    const t = window.setTimeout(() => writeStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    // Load each collection independently so a missing `videos` collection
    // (e.g. migration not yet applied) doesn't block images from rendering.
    // Preserve the success/failure signal per call to drive conn status.
    Promise.all([
      listImages().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load images:', err);
          return { ok: false as const, records: [] as ImageRecord[] };
        },
      ),
      listVideos().then(
        (r) => ({ ok: true as const, records: r }),
        (err) => {
          console.warn('[pb] failed to load videos:', err);
          return { ok: false as const, records: [] as VideoRecord[] };
        },
      ),
    ]).then(([imgRes, vidRes]) => {
      if (cancelled) return;
      const merged: CanvasMedia[] = [
        ...imgRes.records.map(fromImageRecord),
        ...vidRes.records.map(fromVideoRecord),
      ];
      merged.sort((a, b) => a.id.localeCompare(b.id));
      setMedia(merged);
      // "ready" if at least one list call succeeded — the videos collection
      // may legitimately be absent (migration pending) without PB being down.
      setConn(imgRes.ok || vidRes.ok ? 'ready' : 'offline');

      // Fit-all on first visit: when no saved view existed at mount and the
      // user has media on the canvas, frame everything. Snap (animate:false)
      // so the blank default view never lingers as a visible flash. Skipped
      // on subsequent mounts because persistView restored their camera.
      if (
        !initialHadStoredView.current &&
        !didInitialFitRef.current &&
        merged.length > 0
      ) {
        const bounds = mediaBounds(merged);
        if (bounds) {
          didInitialFitRef.current = true;
          // Defer one frame so InfiniteCanvas's container has laid out and
          // focusOn's getBoundingClientRect returns the real viewport size.
          requestAnimationFrame(() => {
            canvasRef.current?.focusOn(bounds, { animate: false });
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the delete handler's dependencies in a ref so the listener doesn't
  // need to re-attach on every media/selection change.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
  }, []);

  // Deletes a media item by id. Used by delete-selection, the empty-input
  // Delete shortcut inside HighlightInput, and the context-menu Delete action.
  const deleteMediaById = useCallback((id: string) => {
    const target = mediaRef.current.find((m) => m.id === id);
    if (!target) return;
    setMedia((prev) => prev.filter((m) => m.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setLastSelectedId((cur) => (cur === id ? null : cur));
    setHoverId((cur) => (cur === id ? null : cur));
    if (target.pending) {
      uploadCtrlsRef.current[id]?.abort();
      URL.revokeObjectURL(target.src);
      return;
    }
    const fn = target.kind === 'video' ? deleteVideo : deleteImage;
    fn(id)
      .then(() => setConn('ready'))
      .catch((err) => {
        console.warn('[pb] delete failed for', id, err);
        setConn('offline');
        setMedia((prev) => [...prev, target]);
      });
  }, []);

  const deleteSelection = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    for (const id of ids) deleteMediaById(id);
  }, [deleteMediaById]);

  // Keyboard shortcuts:
  //   Escape        — release pinned selection
  //   Delete/Backsp — delete the pinned media (skipped while typing)
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable === true
      );
    };
    // Three-layer defense: `document.activeElement` (source of truth for
    // where the next keystroke will land), `e.target` (where this event
    // fired), and a closest() climb up from the target looking for the
    // highlight-input wrapper. The last one catches cases where React's
    // root-level delegation plus stopPropagation still lets the event
    // reach window before focus has resolved.
    const isTypingContext = (e: KeyboardEvent): boolean => {
      if (isEditable(document.activeElement)) return true;
      const target = e.target instanceof Element ? e.target : null;
      if (isEditable(target)) return true;
      if (target?.closest('.highlight-input, input, textarea, [contenteditable="true"]'))
        return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTypingContext(e)) return;
      if (selectedIdsRef.current.size === 0) return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection, deleteSelection]);

  // Cmd/Ctrl+K toggles the macOS-Spotlight-style search palette. Fires
  // globally so it still works when a text input (HighlightInput, etc.) has
  // focus — this is the one shortcut the convention deliberately overrides.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setSearchOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searchItems = useMemo<SearchItem[]>(
    () =>
      media
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          x: m.x,
          y: m.y,
          width: m.width,
          height: m.height,
        })),
    [media],
  );

  const handleSearchSelect = useCallback((item: SearchItem) => {
    setSearchOpen(false);
    canvasRef.current?.focusOn(
      { x: item.x, y: item.y, width: item.width, height: item.height },
      { animate: true },
    );
  }, []);

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback((p: WorldPoint | null) => setCursor(p), []);

  const handleFilesDrop = useCallback(async (files: File[], point: WorldPoint) => {
    // The packaged WebKit webview sometimes hands us File objects whose
    // `type` is empty — fall back to the extension so drops still work.
    const classify = (f: File): MediaKind | null => {
      if (f.type.startsWith('video/')) return 'video';
      if (f.type.startsWith('image/')) return 'image';
      const name = f.name.toLowerCase();
      if (/\.(mp4|webm|mov|m4v|mkv|ogv|avi|3gp)$/.test(name)) return 'video';
      if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/.test(name))
        return 'image';
      return null;
    };
    const accepted = files
      .map((f) => ({ file: f, kind: classify(f) }))
      .filter((e): e is { file: File; kind: MediaKind } => e.kind !== null);
    if (!accepted.length) return;

    const loaded = await Promise.all(
      accepted.map(async ({ file, kind }) => {
        const dims = await (kind === 'video' ? loadVideo(file) : loadImage(file));
        return { file, kind, ...dims };
      }),
    );

    const gap = 32;
    const first = loaded[0];
    if (!first) return;
    let cursorX = point.worldX - first.width / 2;
    const baseY = point.worldY - first.height / 2;

    type Draft = {
      draft: CanvasMedia;
      file: File;
      meta: { x: number; y: number; width: number; height: number; name: string };
    };
    const plan: Draft[] = [];
    for (const l of loaded) {
      const meta = { x: cursorX, y: baseY, width: l.width, height: l.height, name: l.file.name };
      plan.push({
        draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
        file: l.file,
        meta,
      });
      cursorX += l.width + gap;
    }

    setMedia((prev) => [...prev, ...plan.map((p) => p.draft)]);

    const minX = Math.min(...plan.map((p) => p.draft.x));
    const minY = Math.min(...plan.map((p) => p.draft.y));
    const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
    const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));
    canvasRef.current?.focusOn({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

    // Seed the chip with an explicit "sending @ 0%" entry synchronously,
    // BEFORE any await. This guarantees the chip never renders the default
    // "Uploading" placeholder — even if the browser never fires a progress
    // event (common on loopback for small bodies).
    setUploadStatus((prev) => {
      const next = { ...prev };
      for (const p of plan) next[p.draft.id] = { phase: 'sending', pct: 0 };
      return next;
    });

    await Promise.all(
      plan.map(async (p) => {
        const onProgress = (pct: number) => {
          setUploadStatus((prev) => {
            if (!(p.draft.id in prev)) return prev;
            return {
              ...prev,
              [p.draft.id]: {
                phase: pct >= 1 ? 'finalizing' : 'sending',
                pct: Math.min(1, Math.max(0, pct)),
              },
            };
          });
        };
        const ctrl = new AbortController();
        uploadCtrlsRef.current[p.draft.id] = ctrl;
        try {
          const record =
            p.draft.kind === 'video'
              ? await createVideo(p.file, p.meta, onProgress, ctrl.signal)
              : await createImage(p.file, p.meta, onProgress, ctrl.signal);
          const next =
            p.draft.kind === 'video'
              ? fromVideoRecord(record as VideoRecord)
              : fromImageRecord(record as ImageRecord);
          setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));
          URL.revokeObjectURL(p.draft.src);
          setConn('ready');
        } catch (err) {
          if ((err as Error | null)?.name !== 'AbortError') {
            // Surface the failure in-place — keep the pending media visible
            // with an error chip so the user sees what went wrong and can
            // press Delete/Backspace to clean it up. Previously we removed
            // the media silently, which looked like a random "poof".
            const message = (err as Error | null)?.message ?? 'upload failed';
            const responseBody = (err as Error & { responseBody?: string } | null)
              ?.responseBody;
            // Use console.error + structured context so the full server
            // payload is trivial to copy from devtools — the on-canvas chip
            // truncates long errors, so this is the reliable source.
            console.error('[pb] upload failed', {
              file: p.file.name,
              kind: p.draft.kind,
              size: p.file.size,
              type: p.file.type,
              message,
              responseBody,
              error: err,
            });
            setConn('offline');
            setUploadStatus((prev) => ({
              ...prev,
              [p.draft.id]: { phase: 'error', pct: 0, message },
            }));
            // Leave media.pending = true so the overlay keeps rendering.
            return;
          }
        } finally {
          delete uploadCtrlsRef.current[p.draft.id];
        }
        // Clear status on success or abort. Error path returns early above
        // so the error chip stays visible until the user deletes the media.
        setUploadStatus((prev) => {
          if (!(p.draft.id in prev)) return prev;
          const next = { ...prev };
          delete next[p.draft.id];
          return next;
        });
      }),
    );
  }, []);

  // Left-button press on empty canvas. Starts a marquee drag; on pointer-up
  // with no movement, treats it as a click-to-deselect (shift held: no-op
  // so the user can add to the selection by shift-clicking media next).
  const handleBackgroundPointerDown = useCallback((p: BackgroundPointerDown) => {
    // Cancel any in-flight marquee before starting a new one (shouldn't
    // happen, but defensive).
    marqueeRef.current = {
      pointerId: p.pointerId,
      startClientX: p.clientX,
      startClientY: p.clientY,
      startWorldX: p.worldX,
      startWorldY: p.worldY,
      baseSet: new Set(selectedIdsRef.current),
      additive: p.shiftKey,
      moved: false,
    };

    const onMove = (e: PointerEvent) => {
      const m = marqueeRef.current;
      if (!m || e.pointerId !== m.pointerId) return;
      const dxScreen = e.clientX - m.startClientX;
      const dyScreen = e.clientY - m.startClientY;
      if (!m.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
      m.moved = true;
      // Container is position:fixed;inset:0 so client coords map directly.
      const v = viewRef.current;
      const curWorldX = (e.clientX - v.x) / v.scale;
      const curWorldY = (e.clientY - v.y) / v.scale;
      setMarqueeRect({
        minX: Math.min(m.startWorldX, curWorldX),
        minY: Math.min(m.startWorldY, curWorldY),
        maxX: Math.max(m.startWorldX, curWorldX),
        maxY: Math.max(m.startWorldY, curWorldY),
      });
    };

    const onUp = (e: PointerEvent) => {
      const m = marqueeRef.current;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!m || e.pointerId !== m.pointerId) return;
      marqueeRef.current = null;
      if (!m.moved) {
        // Click on empty space:
        //   plain  → clear selection
        //   shift  → leave selection unchanged (compositional intent)
        if (!m.additive) clearSelection();
        setMarqueeRect(null);
        return;
      }
      // Commit the marquee-intersected set to selectedIds.
      const current = mediaRef.current;
      const dxScreen = e.clientX - m.startClientX;
      const dyScreen = e.clientY - m.startClientY;
      const v = viewRef.current;
      const endWorldX = m.startWorldX + dxScreen / v.scale;
      const endWorldY = m.startWorldY + dyScreen / v.scale;
      const minX = Math.min(m.startWorldX, endWorldX);
      const minY = Math.min(m.startWorldY, endWorldY);
      const maxX = Math.max(m.startWorldX, endWorldX);
      const maxY = Math.max(m.startWorldY, endWorldY);
      const hit = new Set<string>();
      for (const item of current) {
        if (
          item.x + item.width >= minX &&
          item.x <= maxX &&
          item.y + item.height >= minY &&
          item.y <= maxY
        ) {
          hit.add(item.id);
        }
      }
      const next = m.additive ? new Set(m.baseSet) : new Set<string>();
      for (const id of hit) next.add(id);
      setSelectedIds(next);
      // Pick a reasonable last-selected anchor — prefer something newly
      // added so HighlightInput has a sensible home if size collapses to 1.
      const newlyAdded = Array.from(hit).find((id) => !m.baseSet.has(id));
      setLastSelectedId(newlyAdded ?? Array.from(next)[next.size - 1] ?? null);
      setMarqueeRect(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [clearSelection]);

  const handleMediaEnter = useCallback(
    (id: string) => {
      clearHideTimer();
      setHoverId(id);
    },
    [clearHideTimer],
  );

  const handleMediaLeave = useCallback(() => {
    scheduleHide();
  }, [scheduleHide]);

  const handleMediaClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      // Shift already toggled in pointerdown — don't re-apply here.
      if (shiftToggledRef.current) {
        shiftToggledRef.current = false;
        return;
      }
      // Suppress click after a drag-move so moving an item doesn't also
      // toggle its selection.
      if (dragRef.current?.anchorId === id && dragRef.current.moved) return;
      clearHideTimer();
      setHoverId(id);
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
    },
    [clearHideTimer],
  );

  const handleMediaDoubleClick = useCallback(
    (e: React.MouseEvent, m: CanvasMedia) => {
      e.stopPropagation();
      if (dragRef.current?.moved) return;
      const bottomInset = HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;
      canvasRef.current?.focusOn(
        { x: m.x, y: m.y, width: m.width, height: m.height },
        { padding: 0.12, bottomInset },
      );
    },
    [],
  );

  const handleMediaContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    clearHideTimer();
    setHoverId(id);
    // If the right-clicked item isn't already in the selection, replace the
    // selection with just this id. If it IS in the selection, leave the
    // multi-selection alone so menu actions (e.g. Delete) apply to the group.
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      return new Set([id]);
    });
    setLastSelectedId(id);
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }, [clearHideTimer]);

  // Trigger a browser download for the given media. For already-uploaded
  // items we fetch-as-blob first — the <a download> attribute is ignored
  // when the URL is cross-origin (which it is in Tauri, where PB is served
  // from 127.0.0.1:8090). Pending uploads still have a local blob: URL, so
  // the anchor works directly.
  const exportMedia = useCallback(async (m: CanvasMedia) => {
    // Prefer the original filename; fall back to the id with a reasonable
    // extension so we never save files with no extension.
    const extFromName = m.name && /\.[a-z0-9]+$/i.test(m.name)
      ? m.name.match(/\.[a-z0-9]+$/i)![0]
      : m.kind === 'video' ? '.mp4' : '.png';
    const filename = m.name && /\.[a-z0-9]+$/i.test(m.name)
      ? m.name
      : `${m.name || m.id}${extFromName}`;

    const triggerDownload = (href: string, revoke: boolean) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so Safari has time to start the download.
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    };

    try {
      if (m.pending) {
        // Local blob: URL — safe to use directly.
        triggerDownload(m.src, false);
        return;
      }
      const res = await fetch(m.src, { credentials: 'include' });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, true);
    } catch (err) {
      console.warn('[export] download failed for', m.id, err);
      // Fallback: try a direct anchor click. Works when the file is
      // same-origin even if fetch was blocked (e.g. adblock / CSP).
      triggerDownload(m.src, false);
    }
  }, []);

  // Sidebar click — focus on the chosen media and pin it, mirroring the
  // combined behavior of a single-click (pins) and double-click (zooms to)
  // on the media itself.
  const handleSidebarSelect = useCallback(
    (id: string) => {
      const target = mediaRef.current.find((m) => m.id === id);
      if (!target) return;
      clearHideTimer();
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
      setHoverId(id);
      const bottomInset = HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;
      canvasRef.current?.focusOn(
        { x: target.x, y: target.y, width: target.width, height: target.height },
        { padding: 0.12, bottomInset },
      );
    },
    [clearHideTimer],
  );

  const handleMediaPointerDown = useCallback((e: MediaPointerEvent, m: CanvasMedia) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Shift+press toggles selection immediately on pointerdown. Previously
    // this lived in the click handler, but click can be suppressed by the
    // browser if any micro-movement happens between down and up (common on
    // a trackpad), which caused additions to silently drop while removals
    // still worked. Toggling here guarantees the selection change lands.
    if (e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(m.id)) next.delete(m.id);
        else next.add(m.id);
        return next;
      });
      setLastSelectedId(m.id);
      shiftToggledRef.current = true;
      // No pointer capture, no drag: treat shift as a selection gesture only.
      return;
    }
    shiftToggledRef.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    // Pick the set of ids to move. If the pressed item is already part of the
    // selection, the whole selection moves together (Figma parity). If it's
    // outside the current selection, we assume the user wants to manipulate
    // just that one item — no implicit multi-select from a plain drag.
    const sel = selectedIdsRef.current;
    const ids = sel.has(m.id) ? sel : new Set<string>([m.id]);
    const orig = new Map<string, DragOrig>();
    for (const item of mediaRef.current) {
      if (ids.has(item.id)) {
        orig.set(item.id, { x: item.x, y: item.y, kind: item.kind });
      }
    }
    dragRef.current = {
      anchorId: m.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      orig,
      moved: false,
      lastDx: 0,
      lastDy: 0,
    };
  }, []);

  const handleMediaPointerMove = useCallback((e: MediaPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dxScreen, dyScreen) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const scale = viewRef.current.scale;
    const dx = dxScreen / scale;
    const dy = dyScreen / scale;
    d.lastDx = dx;
    d.lastDy = dy;
    setMedia((prev) =>
      prev.map((m) => {
        const o = d.orig.get(m.id);
        if (!o) return m;
        return { ...m, x: o.x + dx, y: o.y + dy };
      }),
    );
  }, []);

  const handleMediaPointerUp = useCallback(
    (e: MediaPointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* no-op */
      }
      const { moved, lastDx, lastDy, orig } = d;
      window.setTimeout(() => {
        if (dragRef.current && dragRef.current.pointerId === d.pointerId) {
          dragRef.current = null;
        }
      }, 0);
      if (!moved) return;
      const currentMedia = mediaRef.current;
      for (const [id, o] of orig) {
        const stillPending = currentMedia.find((m) => m.id === id)?.pending;
        if (stillPending) continue;
        const persist =
          o.kind === 'video' ? updateVideoPosition : updateImagePosition;
        const nextX = o.x + lastDx;
        const nextY = o.y + lastDy;
        persist(id, { x: nextX, y: nextY })
          .then(() => setConn('ready'))
          .catch((err) => {
            console.warn('[pb] move failed for', id, err);
            setConn('offline');
            setMedia((prev) =>
              prev.map((mm) => (mm.id === id ? { ...mm, x: o.x, y: o.y } : mm)),
            );
          });
      }
    },
    [],
  );

  // InfiniteCanvas reads this once on mount. Memoized so React never gets a
  // fresh object on subsequent renders (which would be ignored anyway, but
  // keeps intent explicit).
  const initial = useMemo<Partial<View>>(() => getInitialView(), []);

  const isEmpty = media.length === 0 && conn !== 'connecting';

  const activeRect = activeMedia
    ? {
        x: activeMedia.x * view.scale + view.x,
        y: activeMedia.y * view.scale + view.y,
        width: activeMedia.width * view.scale,
        height: activeMedia.height * view.scale,
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
        onBackgroundPointerDown={handleBackgroundPointerDown}
        zoomSensitivity={settings.zoomSensitivity}
        panSpeed={settings.panSpeed}
      >
        {visibleMedia.map((m) => (
          <MediaItem
            key={m.id}
            m={m}
            isActive={activeSet.has(m.id)}
            onEnter={handleMediaEnter}
            onLeave={handleMediaLeave}
            onClick={handleMediaClick}
            onDoubleClick={handleMediaDoubleClick}
            onContextMenu={handleMediaContextMenu}
            onPointerDown={handleMediaPointerDown}
            onPointerMove={handleMediaPointerMove}
            onPointerUp={handleMediaPointerUp}
          />
        ))}
      </InfiniteCanvas>

      {visibleMedia
        .filter((m) => m.pending)
        .map((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          // Hide the label for small rects so the pill doesn't overflow.
          const showLabel = rw > 160 && rh > 72;
          const status = uploadStatus[m.id];
          const isError = status?.phase === 'error';
          // Label priority:
          //   phase 'error'      → "Failed — <message>"
          //   phase 'finalizing' → "Finalizing"
          //   phase 'sending'    → "NN%"
          //   no status yet      → "Uploading" (pre-seed; should be brief)
          let label = 'Uploading';
          if (status) {
            if (status.phase === 'error') {
              label = status.message
                ? `Failed — ${status.message}`
                : 'Failed';
            } else if (status.phase === 'finalizing') {
              label = 'Finalizing';
            } else {
              label = `${Math.floor(status.pct * 100)}%`;
            }
          }
          return (
            <div
              key={`pending-${m.id}`}
              className={`pending-overlay ${isError ? 'is-error' : ''}`}
              style={{ left: rx, top: ry, width: rw, height: rh }}
              role="status"
              aria-live="polite"
              aria-label={`${m.kind} ${isError ? 'upload failed' : 'uploading'}, ${label}`}
              // Always expose the full label as a tooltip on error states —
              // the chip truncates long messages with ellipsis, so without
              // this the user can't see the server's reason without devtools.
              title={isError ? label : undefined}
            >
              <div className={`pending-chip ${isError ? 'is-error' : ''}`}>
                {isError ? (
                  <i className="ri-error-warning-line pending-chip-icon" aria-hidden />
                ) : (
                  <span className="pending-spinner" aria-hidden />
                )}
                {showLabel && <span className="pending-label">{label}</span>}
              </div>
            </div>
          );
        })}

      {activeMedia && activeRect && (
        <HighlightInput
          key={activeMedia.id}
          rect={activeRect}
          value={highlightInputs[activeMedia.id] ?? ''}
          onChange={(v) =>
            setHighlightInputs((prev) => ({ ...prev, [activeMedia.id]: v }))
          }
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onFocus={() => {
            clearHideTimer();
            setSelectedIds(new Set([activeMedia.id]));
            setLastSelectedId(activeMedia.id);
          }}
          onBlur={() => {
            const v = highlightInputs[activeMedia.id] ?? '';
            if (!v) clearSelection();
            scheduleHide();
          }}
          onEscape={() => {
            clearSelection();
            scheduleHide();
          }}
          onDeleteWhenEmpty={deleteSelection}
          autoFocus={selectedIds.has(activeMedia.id)}
        />
      )}

      {marqueeRect && (
        <div
          className="marquee-rect"
          aria-hidden
          style={{
            left: marqueeRect.minX * view.scale + view.x,
            top: marqueeRect.minY * view.scale + view.y,
            width: Math.max(0, (marqueeRect.maxX - marqueeRect.minX) * view.scale),
            height: Math.max(0, (marqueeRect.maxY - marqueeRect.minY) * view.scale),
          }}
        />
      )}

      {selectionBBox && !marqueeRect && (
        <div
          className="selection-bbox"
          aria-hidden
          style={{
            left: selectionBBox.minX * view.scale + view.x,
            top: selectionBBox.minY * view.scale + view.y,
            width: Math.max(0, (selectionBBox.maxX - selectionBBox.minX) * view.scale),
            height: Math.max(0, (selectionBBox.maxY - selectionBBox.minY) * view.scale),
          }}
        >
          <span className="selection-bbox-handle tl" />
          <span className="selection-bbox-handle tr" />
          <span className="selection-bbox-handle bl" />
          <span className="selection-bbox-handle br" />
          <span className="selection-bbox-count">
            <i className="ri-checkbox-multiple-blank-line" aria-hidden />
            {selectedIds.size}
          </span>
        </div>
      )}

      {isEmpty && (
        <div className="empty-state" aria-hidden>
          <div className="empty-state-inner">
            <div className="empty-eyebrow">Drop to begin</div>
            <div className="empty-title">
              Drop images or videos <span className="accent">anywhere</span>
            </div>
            <div className="empty-sub">They'll land where you drop and zoom into view.</div>
          </div>
        </div>
      )}

      <FloatingSidebar
        items={media}
        activeId={activeId}
        onSelect={handleSidebarSelect}
      />

      {contextMenu && (() => {
        const target = media.find((m) => m.id === contextMenu.id);
        if (!target) return null;
        const items: ContextMenuItem[] = [
          {
            id: 'export',
            label: 'Export',
            icon: 'ri-download-2-line',
            onSelect: () => { void exportMedia(target); },
          },
          {
            id: 'delete',
            label: selectedIds.size > 1 && selectedIds.has(target.id)
              ? `Delete ${selectedIds.size} items`
              : 'Delete',
            icon: 'ri-delete-bin-line',
            danger: true,
            onSelect: () => {
              if (selectedIds.has(target.id) && selectedIds.size > 1) {
                deleteSelection();
              } else {
                deleteMediaById(target.id);
              }
            },
          },
        ];
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}

      <div className="hud hud-top-left">
        <div className="wordmark" aria-label="NetraRT">
          <a href="/" className="wordmark-link">
            <span className="wordmark-glyph">NetraRT</span>
          </a>
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
            aria-label="Fit all to view"
            onClick={() => {
              const items = mediaRef.current;
              if (items.length === 0) {
                canvasRef.current?.reset();
                return;
              }
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              for (const m of items) {
                if (m.x < minX) minX = m.x;
                if (m.y < minY) minY = m.y;
                if (m.x + m.width > maxX) maxX = m.x + m.width;
                if (m.y + m.height > maxY) maxY = m.y + m.height;
              }
              canvasRef.current?.focusOn(
                { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
                { padding: 0.12 },
              );
            }}
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

      <div className="hud hud-top-right">
        <div className="btn-cluster" role="group" aria-label="App controls">
          <button
            className="btn-ghost"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ri-settings-3-line" aria-hidden />
          </button>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSetting}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <SearchPalette
        open={searchOpen}
        items={searchItems}
        onSelect={handleSearchSelect}
        onClose={() => setSearchOpen(false)}
      />
    </>
  );
}
