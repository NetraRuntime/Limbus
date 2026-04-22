import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
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
import { useAutoLiquidGlassFilter } from './components/LiquidGlass';
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

const HOVER_HIDE_MS = 160;
const DRAG_THRESHOLD_PX = 4;

type DragOrig = { x: number; y: number; kind: MediaKind };

type DragState = {
  anchorId: string;
  pointerId: number;
  startX: number;
  startY: number;
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
  baseSet: Set<string>;
  additive: boolean;
  moved: boolean;
};

type UploadPhase = 'sending' | 'finalizing' | 'error';
type UploadStatus = { phase: UploadPhase; pct: number; message?: string };

const HIGHLIGHT_BOTTOM_INSET_PX = HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;

type UploadPlan = {
  draft: CanvasMedia;
  file: File;
  meta: { x: number; y: number; width: number; height: number; name: string };
};

const VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';
const VIEW_PERSIST_DEBOUNCE_MS = 200;

const CULL_BUFFER_FACTOR = 0.5;

const StoredViewSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
});

const readStoredView = (): View | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = StoredViewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    
    return null;
  }
};

const writeStoredView = (v: View) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(v));
  } catch {
    
  }
};

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

type MediaPointerEvent = React.PointerEvent<HTMLElement>;

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

  const labelCls = `media-label ${isActive ? 'is-active' : ''}`;
  const label = (
    // Canvas items are pointer-driven; keyboard access to individual items
    // happens through the SearchPalette (Cmd+K) which lists every media by
    // name and focuses the picked one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span
      className={labelCls}
      style={{ left: m.x, top: m.y }}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onClick={handleClick}
      onDoubleClick={handleDouble}
      onContextMenu={handleContext}
      onPointerDown={handleDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
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
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
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

const getInitialView = (): View => {
  const stored = readStoredView();
  if (stored) return stored;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2, scale: 1 };
};

export function Canvas() {
  // HUD liquid-glass filters. Each one measures its own element via
  // ResizeObserver; pill surfaces use radius 999 (auto-clamped to
  // height/2 in the hook), the wordmark uses the design-system md
  // corner.
  const searchPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const statusPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const controlsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const settingsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });

  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const initialHadStoredView = useRef<boolean>(readStoredView() !== null);
  const didInitialFitRef = useRef<boolean>(false);
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  const uploadCtrlsRef = useRef<Record<string, AbortController>>({});

  // Highlight interaction state.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string>>({});
  const [multiHighlightInput, setMultiHighlightInput] = useState('');
  const hideTimer = useRef<number | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    minX: number; minY: number; maxX: number; maxY: number;
  } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const shiftToggledRef = useRef(false);
  const viewRef = useRef<View>(view);
  viewRef.current = view;

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

  const multiSelectKey = useMemo(() => {
    if (selectedIds.size < 2) return '';
    return Array.from(selectedIds).sort().join(' ');
  }, [selectedIds]);
  useEffect(() => {
    setMultiHighlightInput('');
  }, [multiSelectKey]);

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

  useEffect(() => {
    const t = window.setTimeout(() => writeStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
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
      setConn(imgRes.ok || vidRes.ok ? 'ready' : 'offline');

      if (
        !initialHadStoredView.current &&
        !didInitialFitRef.current &&
        merged.length > 0
      ) {
        const bounds = mediaBounds(merged);
        if (bounds) {
          didInitialFitRef.current = true;
          requestAnimationFrame(() => {
            canvasRef.current?.focusOn(bounds, {
              animate: false,
              bottomInset: HIGHLIGHT_BOTTOM_INSET_PX,
            });
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mediaRef = useRef(media);
  mediaRef.current = media;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Raise the given ids to the top of the media stacking order by moving them
  // to the end of the array. DOM sibling order drives paint order for absolute
  // positioned siblings, so this makes the raise persist after deselection.
  const bringToFront = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    setMedia((prev) => {
      if (prev.length <= 1) return prev;
      const below: CanvasMedia[] = [];
      const raised: CanvasMedia[] = [];
      for (const m of prev) {
        if (ids.has(m.id)) raised.push(m);
        else below.push(m);
      }
      if (raised.length === 0 || raised.length === prev.length) return prev;
      let alreadyAtEnd = true;
      for (let i = 0; i < raised.length; i++) {
        if (prev[below.length + i]?.id !== raised[i]!.id) {
          alreadyAtEnd = false;
          break;
        }
      }
      if (alreadyAtEnd) return prev;
      return [...below, ...raised];
    });
  }, []);

  useEffect(() => {
    if (selectedIds.size === 0) return;
    bringToFront(selectedIds);
  }, [selectedIds, bringToFront]);

  const runUploadPlan = useCallback(
    (plan: UploadPlan[]): Promise<void> => {
      if (plan.length === 0) return Promise.resolve();
      setMedia((prev) => [...prev, ...plan.map((p) => p.draft)]);
      setUploadStatus((prev) => {
        const next = { ...prev };
        for (const p of plan) next[p.draft.id] = { phase: 'sending', pct: 0 };
        return next;
      });
      return Promise.all(
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
              p.draft.kind === 'video' ? fromVideoRecord(record) : fromImageRecord(record);
            setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));
            URL.revokeObjectURL(p.draft.src);
            setConn('ready');
          } catch (err) {
            if ((err as Error | null)?.name !== 'AbortError') {
              const message = (err as Error | null)?.message ?? 'upload failed';
              const responseBody = (err as Error & { responseBody?: string } | null)
                ?.responseBody;
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
              return;
            }
          } finally {
            delete uploadCtrlsRef.current[p.draft.id];
          }
          setUploadStatus((prev) => {
            if (!(p.draft.id in prev)) return prev;
            const next = { ...prev };
            delete next[p.draft.id];
            return next;
          });
        }),
      ).then(() => {});
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
  }, []);

  const selectAll = useCallback(() => {
    const all = mediaRef.current;
    if (all.length === 0) return;
    setSelectedIds(new Set(all.map((m) => m.id)));
    setLastSelectedId(null);
  }, []);

  const DUPLICATE_OFFSET = 64;

  const duplicateSelection = useCallback(async () => {
    const ids = selectedIdsRef.current;
    if (ids.size === 0) return;
    const sources = mediaRef.current.filter((m) => ids.has(m.id) && !m.pending);
    if (sources.length === 0) return;

    const plans = await Promise.all(
      sources.map(async (m): Promise<UploadPlan | null> => {
        try {
          const res = await fetch(m.src);
          if (!res.ok) throw new Error(`fetch ${m.name}: ${res.status}`);
          const blob = await res.blob();
          const type = blob.type || res.headers.get('content-type') || '';
          const file = new File([blob], m.name, { type });
          const src = URL.createObjectURL(blob);
          const meta = {
            x: m.x + DUPLICATE_OFFSET,
            y: m.y + DUPLICATE_OFFSET,
            width: m.width,
            height: m.height,
            name: m.name,
          };
          return {
            draft: { id: uid(), kind: m.kind, src, pending: true, ...meta },
            file,
            meta,
          };
        } catch (err) {
          console.warn('[pb] duplicate source fetch failed for', m.id, err);
          return null;
        }
      }),
    );

    const plan = plans.filter((p): p is UploadPlan => p !== null);
    if (plan.length === 0) return;

    setSelectedIds(new Set(plan.map((p) => p.draft.id)));
    setLastSelectedId(plan.length === 1 ? plan[0]!.draft.id : null);
    void runUploadPlan(plan);
  }, [runUploadPlan]);

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
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'a'
      ) {
        if (isTypingContext(e)) return;
        e.preventDefault();
        selectAll();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'd'
      ) {
        e.preventDefault();
        if (selectedIdsRef.current.size === 0) return;
        void duplicateSelection();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTypingContext(e)) return;
      if (selectedIdsRef.current.size === 0) return;
      e.preventDefault();
      deleteSelection();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [clearSelection, deleteSelection, selectAll, duplicateSelection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setSearchOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
      { animate: true, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
    );
  }, []);

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback((p: WorldPoint | null) => setCursor(p), []);

  const handleFilesDrop = useCallback(async (files: File[], point: WorldPoint) => {
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

    const plan: UploadPlan[] = [];
    for (const l of loaded) {
      const meta = { x: cursorX, y: baseY, width: l.width, height: l.height, name: l.file.name };
      plan.push({
        draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
        file: l.file,
        meta,
      });
      cursorX += l.width + gap;
    }

    const minX = Math.min(...plan.map((p) => p.draft.x));
    const minY = Math.min(...plan.map((p) => p.draft.y));
    const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
    const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));

    const uploading = runUploadPlan(plan);
    canvasRef.current?.focusOn(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
    );
    await uploading;
  }, [runUploadPlan]);

  const handleBackgroundPointerDown = useCallback((p: BackgroundPointerDown) => {
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
      canvasRef.current?.focusOn(
        { x: m.x, y: m.y, width: m.width, height: m.height },
        { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [],
  );

  const handleMediaContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    clearHideTimer();
    setHoverId(id);
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      return new Set([id]);
    });
    setLastSelectedId(id);
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }, [clearHideTimer]);

  const exportMedia = useCallback(async (m: CanvasMedia) => {
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
      triggerDownload(m.src, false);
    }
  }, []);

  const handleSidebarSelect = useCallback(
    (id: string) => {
      const target = mediaRef.current.find((m) => m.id === id);
      if (!target) return;
      clearHideTimer();
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
      setHoverId(id);
      canvasRef.current?.focusOn(
        { x: target.x, y: target.y, width: target.width, height: target.height },
        { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [clearHideTimer],
  );

  const handleMediaPointerDown = useCallback((e: MediaPointerEvent, m: CanvasMedia) => {
    if (e.button !== 0) return;
    e.stopPropagation();
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
    // Covers the drag-without-selection case: clicking and dragging an
    // unselected item won't fire click (moved=true suppresses it), so the
    // selectedIds-driven raise effect wouldn't run. Raise here too.
    bringToFront(ids);
  }, [bringToFront]);

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

      {selectionBBox && !marqueeRect && (() => {
        const LABEL_OVERHANG_PX = 26;
        return (
        <div
          className="selection-bbox"
          aria-hidden
          style={{
            left: selectionBBox.minX * view.scale + view.x,
            top: selectionBBox.minY * view.scale + view.y - LABEL_OVERHANG_PX,
            width: Math.max(0, (selectionBBox.maxX - selectionBBox.minX) * view.scale),
            height: Math.max(
              0,
              (selectionBBox.maxY - selectionBBox.minY) * view.scale + LABEL_OVERHANG_PX,
            ),
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
        );
      })()}

      {selectionBBox && !marqueeRect && (
        <HighlightInput
          rect={{
            x: selectionBBox.minX * view.scale + view.x,
            y: selectionBBox.minY * view.scale + view.y,
            width: Math.max(0, (selectionBBox.maxX - selectionBBox.minX) * view.scale),
            height: Math.max(0, (selectionBBox.maxY - selectionBBox.minY) * view.scale),
          }}
          value={multiHighlightInput}
          onChange={setMultiHighlightInput}
          onEscape={clearSelection}
          onDeleteWhenEmpty={deleteSelection}
        />
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
        {wordmarkGlass.filterSvg}
        <div
          ref={wordmarkGlass.ref}
          className="wordmark is-liquid-glass"
          aria-label="NetraRT"
          style={wordmarkGlass.style}
        >
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
        {searchPillGlass.filterSvg}
        {statusPillGlass.filterSvg}
        {controlsPillGlass.filterSvg}
        <div
          ref={searchPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Search"
          style={searchPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Search media (⌘K / Ctrl+K)"
            title="Search media (⌘K)"
            onClick={() => setSearchOpen(true)}
          >
            <i className="ri-search-line" aria-hidden />
          </button>
        </div>

        <div
          ref={statusPillGlass.ref}
          className="status-pill is-liquid-glass"
          style={statusPillGlass.style}
        >
          <span className="status-label">Zoom</span>
          <span className="status-value">{formatZoom(view.scale)}</span>
          <span className="status-sep" aria-hidden />
          <span className="status-label">X</span>
          <span className="status-value">{formatCoord(cursor?.worldX)}</span>
          <span className="status-label">Y</span>
          <span className="status-value">{formatCoord(cursor?.worldY)}</span>
        </div>

        <div
          ref={controlsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Canvas controls"
          style={controlsPillGlass.style}
        >
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
                { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
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
        {settingsPillGlass.filterSvg}
        <div
          ref={settingsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="App controls"
          style={settingsPillGlass.style}
        >
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
