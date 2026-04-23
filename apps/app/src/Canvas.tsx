import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
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
  deleteAllSegmentationsForImage,
  deleteImage,
  deleteSegmentationsForImage,
  deleteVideo,
  hardDeleteImage,
  hardDeleteVideo,
  imageFileUrl,
  listImages,
  listSegmentations,
  listTrashed,
  listVideos,
  updateImagePosition,
  updateVideoPosition,
  upsertSegmentation,
  videoFileUrl,
  type ImageRecord,
  type MediaKind,
  type SegmentationRecord,
  type VideoRecord,
} from './lib/pb';
import {
  HighlightInput,
  HIGHLIGHT_INPUT_GAP,
  HIGHLIGHT_INPUT_HEIGHT,
} from './components/HighlightInput';
import { colorForTag } from './components/savedTags';
import { FloatingSidebar } from './components/FloatingSidebar';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { SettingsModal } from './components/SettingsModal';
import { Sam3VersionBadge } from './components/Sam3VersionBadge';
import { SavedTagsPopover } from './components/SavedTagsPopover';
import { SearchPalette, type SearchItem } from './components/SearchPalette';
import { MediaToolbar, type CanvasTool } from './components/MediaToolbar';
import { useAutoLiquidGlassFilter } from './components/LiquidGlass';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import {
  computeLabelPlacements,
  type LabelPlacement,
} from './lib/labelPlacement';
import { labelOuterWidth } from './lib/labelMetrics';
import { groupSegmentationsByImage } from './lib/segmentations';
import { isTypingContext } from './lib/dom/isTypingContext';
import { useHistory, useHistoryShortcuts } from './lib/history';
import {
  moveEntry,
  deleteEntry,
  createEntry,
  type CanvasActionMeta,
  type HistoryMedia,
} from './lib/canvasHistory';
import {
  buildDescriptorFromFile,
  captureDataTransfer,
  dropContainsFolderOrZip,
  scanTauriPaths,
  type MediaDescriptor,
  type ScanInput,
} from './lib/mediaIngest';
import { subscribeTauriDrops } from './lib/tauriDragDrop';
import { placeGrid } from './lib/gridPlacement';
import { useImportPreview } from './hooks/useImportPreview';
import { ImportPreviewModal } from './components/ImportPreviewModal';
import {
  createLodCache,
  createMipWorkerClient,
  useLodHydration,
  useLodSources,
  type LodCache,
  type MipWorkerClient,
} from './features/lod';
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
  /** PocketBase collection id — present for uploaded (non-pending) items.
   *  Used to resolve the on-disk file path for SAM3 segmentation. */
  collectionId?: string;
  /** PocketBase file field (the storage filename). Pairs with `collectionId`. */
  file?: string;
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
  collectionId: r.collectionId,
  file: r.file,
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
  collectionId: r.collectionId,
  file: r.file,
});

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function precacheImageEncoding(record: ImageRecord): Promise<void> {
  try {
    await invoke('sam3_encode_image', {
      id: record.id,
      collectionId: record.collectionId,
      file: record.file,
    });
  } catch (err) {
    console.warn('[sam3] precache failed for', record.id, err);
  }
}

async function deleteImageEncoding(id: string): Promise<void> {
  try {
    await invoke('sam3_delete_image_cache', { id });
  } catch (err) {
    console.warn('[sam3] cache delete failed for', id, err);
  }
}

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

type SegMask = {
  png_base64: string;
  width: number;
  height: number;
  score: number;
  bbox: [number, number, number, number] | null;
};

type SegmentResponse = {
  masks: SegMask[];
  source_width: number;
  source_height: number;
};

type TagSegment =
  | { tag: string; status: 'loading' }
  | { tag: string; status: 'ready'; response: SegmentResponse }
  | { tag: string; status: 'error'; message: string };

type SegmentState = { entries: TagSegment[] };

const HIGHLIGHT_BOTTOM_INSET_PX = HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;

type UploadPlan = {
  draft: CanvasMedia;
  file: File;
  meta: { x: number; y: number; width: number; height: number; name: string };
};

const VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';
const VIEW_PERSIST_DEBOUNCE_MS = 200;

const STACK_ORDER_STORAGE_KEY = 'netrart:canvas:stack-order:v1';
const STACK_ORDER_PERSIST_DEBOUNCE_MS = 200;

const EMPTY_TAGS: readonly string[] = Object.freeze([]);

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

const StoredStackOrderSchema = z.array(z.string());

const readStoredStackOrder = (): string[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STACK_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = StoredStackOrderSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

const writeStoredStackOrder = (order: string[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STACK_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {

  }
};

/** World-unit target for a new upload when no existing media is present. */
const DEFAULT_UPLOAD_LONGEST_SIDE = 640;

/** Scale `dims` so its longest side matches the median longest-side of the
 *  given reference items. Keeps aspect ratio. Rounded to integer world units
 *  to keep the persisted meta and the on-disk source_width/source_height
 *  cleanly aligned. Pending items are filtered out by the caller so in-flight
 *  uploads don't skew the reference. */
const normalizeUploadSize = (
  dims: { width: number; height: number },
  reference: readonly { width: number; height: number }[],
): { width: number; height: number } => {
  if (dims.width <= 0 || dims.height <= 0) return dims;
  const target =
    reference.length === 0
      ? DEFAULT_UPLOAD_LONGEST_SIDE
      : medianLongestSide(reference);
  if (!target || !Number.isFinite(target) || target <= 0) return dims;
  const longest = Math.max(dims.width, dims.height);
  if (longest <= 0) return dims;
  const k = target / longest;
  return {
    width: Math.max(1, Math.round(dims.width * k)),
    height: Math.max(1, Math.round(dims.height * k)),
  };
};

const medianLongestSide = (
  items: readonly { width: number; height: number }[],
): number => {
  const longs: number[] = [];
  for (const m of items) {
    const s = Math.max(m.width, m.height);
    if (Number.isFinite(s) && s > 0) longs.push(s);
  }
  if (longs.length === 0) return 0;
  longs.sort((a, b) => a - b);
  const mid = longs.length >> 1;
  return longs.length % 2 === 0 ? (longs[mid - 1]! + longs[mid]!) / 2 : longs[mid]!;
};

function describeDrop(captured: ScanInput): string {
  const firstDir = captured.entries.find((e) => e && e.isDirectory)?.name;
  if (firstDir) return firstDir;
  const firstZip = captured.fallbackFiles.find((f) => /\.zip$/i.test(f.name))?.name;
  if (firstZip) return firstZip;
  const first = captured.entries[0]?.name ?? captured.fallbackFiles[0]?.name;
  const count = captured.entries.length + captured.fallbackFiles.length;
  if (count <= 1 && first) return first;
  return `${count} sources`;
}

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
  placement: LabelPlacement;
  lodSrc?: string;
  playVideo?: boolean;
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
  placement,
  lodSrc,
  playVideo = true,
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

  const labelLeft =
    placement === 'tr' || placement === 'br' ? m.x + m.width : m.x;
  const labelTop =
    placement === 'bl' || placement === 'br' ? m.y + m.height : m.y;

  const labelCls = `media-label ${isActive ? 'is-active' : ''}`;
  const label = (
    // Canvas items are pointer-driven; keyboard access to individual items
    // happens through the SearchPalette (Cmd+K) which lists every media by
    // name and focuses the picked one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span
      className={labelCls}
      data-placement={placement}
      style={{ left: labelLeft, top: labelTop }}
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
    if (!playVideo) {
      return (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
          <img
            src={lodSrc ?? m.src}
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
    }
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
        src={lodSrc ?? m.src}
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

type CanvasProps = {
  /** When set, SAM3 failed to load. Encode/segment calls are skipped and a
   *  compact error chip is shown in the top-left HUD. */
  sam3Error?: string | null;
};

export function Canvas({ sam3Error = null }: CanvasProps = {}) {
  const sam3Available = !sam3Error;
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
  const [lodCache, setLodCache] = useState<LodCache | null>(null);
  const [lodWorker, setLodWorker] = useState<MipWorkerClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    createLodCache()
      .then((c) => {
        if (!cancelled) setLodCache(c);
      })
      .catch((err) => console.warn('[lod] cache open failed', err));
    const worker = createMipWorkerClient();
    setLodWorker(worker);
    return () => {
      cancelled = true;
      worker?.terminate();
      setLodWorker(null);
    };
  }, []);

  const initialHadStoredView = useRef<boolean>(readStoredView() !== null);
  const didInitialFitRef = useRef<boolean>(false);
  // Flipped once the PocketBase list fetch has resolved. Guards the
  // media→stackOrder sync effect from running against the empty initial
  // `media` and wiping the hydrated order before data arrives.
  const initialMediaLoadedRef = useRef<boolean>(false);
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  // Parallel to `media`, in canvas paint order (bottom → top). Kept separate
  // so raising an item to the top doesn't reshuffle the sidebar, which
  // renders `media` in its canonical (load/insertion) order. Hydrated from
  // localStorage so prior raises persist across reloads; the media-sync
  // effect below reconciles ids against what's actually on the canvas.
  const [stackOrder, setStackOrder] = useState<string[]>(readStoredStackOrder);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  const [encodingIds, setEncodingIds] = useState<Set<string>>(() => new Set());
  const [segments, setSegments] = useState<Record<string, SegmentState>>({});
  const segmentSeqRef = useRef<Record<string, number>>({});
  const uploadCtrlsRef = useRef<Record<string, AbortController>>({});

  // Highlight interaction state.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string[]>>({});
  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);
  const hideTimer = useRef<number | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    minX: number; minY: number; maxX: number; maxY: number;
  } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tool, setTool] = useState<CanvasTool>('drag');
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Surface the tool to global CSS so we can swap the cursor on world media
  // without re-rendering every MediaItem when the tool changes.
  useEffect(() => {
    document.body.dataset.canvasTool = tool;
    return () => {
      delete document.body.dataset.canvasTool;
    };
  }, [tool]);

  const history = useHistory<CanvasActionMeta>({
    limit: 100,
    onError: (err, phase) => {
      console.warn(`[history] ${phase} failed`, err);
    },
  });
  useHistoryShortcuts(history);

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
    setMultiHighlightInput([]);
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

  // Canvas paint order: apply `stackOrder` on top of `visibleMedia`. Items not
  // yet ranked (freshly loaded or uploaded before the sync effect runs) sort
  // below ranked ones, breaking ties by their media-array position.
  const paintMedia = useMemo(() => {
    if (visibleMedia.length <= 1) return visibleMedia;
    const rank = new Map<string, number>();
    stackOrder.forEach((id, i) => rank.set(id, i));
    const fallback = new Map<string, number>();
    media.forEach((m, i) => fallback.set(m.id, i));
    const items = [...visibleMedia];
    items.sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return 1;
      if (rb !== undefined) return -1;
      return (fallback.get(a.id) ?? 0) - (fallback.get(b.id) ?? 0);
    });
    return items;
  }, [visibleMedia, stackOrder, media]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const lodItems = useMemo(
    () =>
      paintMedia
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          src: m.src,
          width: m.width,
          height: m.height,
        })),
    [paintMedia],
  );
  const { sources: lodSources, reportLevelBlob, reportDims, dropAsset } = useLodSources({
    items: lodItems,
    viewScale: view.scale,
    dpr,
    cache: lodCache,
  });
  const [priorityIds, setPriorityIds] = useState<Set<string>>(() => new Set());

  const hydrationItems = useMemo(
    () =>
      media
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          src: m.src,
          priority: priorityIds.has(m.id),
        })),
    [media, priorityIds],
  );

  const handleLevelReady = useCallback(
    (e: { assetId: string; levelPx: number; blob: Blob }) => {
      reportLevelBlob(e.assetId, e.levelPx, e.blob);
    },
    [reportLevelBlob],
  );

  const handleAssetReady = useCallback(
    (id: string) => {
      setPriorityIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (lodCache) {
        void lodCache.getDims(id).then((d) => {
          if (d) reportDims(id, d.naturalWidth, d.naturalHeight);
        });
      }
    },
    [lodCache, reportDims],
  );

  useLodHydration({
    items: hydrationItems,
    cache: lodCache,
    worker: lodWorker,
    onLevelReady: handleLevelReady,
    onAssetReady: handleAssetReady,
  });

  // Label placement: per-item corner (tl/tr/bl/br) chosen so the filename
  // badge doesn't land over a strictly-higher-stacked neighbor. Rank comes
  // from `stackOrder` (canvas paint order) with a fallback index in
  // `media` for items not yet synced into it.
  const labelPlacements = useMemo(() => {
    const rankMap = new Map<string, number>();
    const baseOffset = media.length;
    media.forEach((m, i) => rankMap.set(m.id, i));
    stackOrder.forEach((id, i) => rankMap.set(id, baseOffset + i));
    return computeLabelPlacements({
      items: paintMedia,
      rank: (id) => rankMap.get(id) ?? -1,
      scale: view.scale,
      labelWidth: labelOuterWidth,
    });
  }, [paintMedia, media, stackOrder, view.scale]);

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
    const t = window.setTimeout(
      () => writeStoredStackOrder(stackOrder),
      STACK_ORDER_PERSIST_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [stackOrder]);

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
      listSegmentations().then(
        (r) => r,
        (err) => {
          console.warn('[pb] failed to load segmentations:', err);
          return [] as SegmentationRecord[];
        },
      ),
    ]).then(([imgRes, vidRes, segRows]) => {
      if (cancelled) return;
      const merged: CanvasMedia[] = [
        ...imgRes.records.map(fromImageRecord),
        ...vidRes.records.map(fromVideoRecord),
      ];
      merged.sort((a, b) => a.id.localeCompare(b.id));
      setMedia(merged);

      const grouped = groupSegmentationsByImage(segRows);
      if (grouped.size > 0) {
        const initial: Record<string, SegmentState> = {};
        for (const [imageId, rows] of grouped) {
          initial[imageId] = {
            entries: rows.map((r) => ({
              tag: r.tag,
              status: 'ready' as const,
              response: {
                masks: r.masks,
                source_width: r.source_width,
                source_height: r.source_height,
              },
            })),
          };
        }
        setSegments((prev) => ({ ...initial, ...prev }));
      }
      // Only flip the "loaded" gate when we actually heard back from PB; if
      // both collections errored out we don't know the true membership, so
      // leaving stackOrder alone is safer than reconciling against `[]`.
      if (imgRes.ok || vidRes.ok) initialMediaLoadedRef.current = true;
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

  // Launch-time sweep: hard-delete PB records soft-deleted more than 1 hour
  // ago. Catches sessions that ended before an entry could be evicted from
  // the history stack (quits, crashes, or idle closes).
  useEffect(() => {
    let cancelled = false;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    void listTrashed({ olderThanMs: ONE_HOUR_MS })
      .then(({ images, videos }) => {
        if (cancelled) return;
        for (const img of images) {
          void hardDeleteImage(img.id)
            .then(() => {
              void deleteImageEncoding(img.id);
            })
            .catch((err) => {
              console.warn('[history] sweep hardDeleteImage failed', img.id, err);
            });
        }
        for (const vid of videos) {
          void hardDeleteVideo(vid.id).catch((err) => {
            console.warn('[history] sweep hardDeleteVideo failed', vid.id, err);
          });
        }
      })
      .catch((err) => {
        console.warn('[history] trash sweep failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mediaRef = useRef(media);
  mediaRef.current = media;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;

  // Keep `stackOrder` in step with `media` membership: new items get appended
  // to the top of the stack, deleted items fall out. The relative order of
  // already-tracked items is preserved so prior raises persist.
  //
  // Gated on initialMediaLoadedRef because `media` starts as `[]` while the
  // PocketBase list call is in flight — running the sync against that empty
  // transient would drop every hydrated id and wipe persisted stacking order.
  useEffect(() => {
    if (!initialMediaLoadedRef.current) return;
    setStackOrder((prev) => {
      const currentIds = new Set(media.map((m) => m.id));
      const kept = prev.filter((id) => currentIds.has(id));
      const keptSet = new Set(kept);
      const added: string[] = [];
      for (const m of media) {
        if (!keptSet.has(m.id)) added.push(m.id);
      }
      if (added.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...added];
    });
  }, [media]);

  // Raise the given ids to the top of the canvas stacking order by moving
  // them to the end of `stackOrder`. `media` itself is left untouched, so
  // the sidebar (which renders `media` directly) does not reshuffle.
  const bringToFront = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    setStackOrder((prev) => {
      if (prev.length <= 1) return prev;
      const below: string[] = [];
      const raised: string[] = [];
      for (const id of prev) {
        if (ids.has(id)) raised.push(id);
        else below.push(id);
      }
      if (raised.length === 0 || raised.length === prev.length) return prev;
      let alreadyAtEnd = true;
      for (let i = 0; i < raised.length; i++) {
        if (prev[below.length + i] !== raised[i]) {
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
            setPriorityIds((prev) => {
              const out = new Set(prev);
              out.add(next.id);
              return out;
            });
            URL.revokeObjectURL(p.draft.src);
            setConn('ready');
            if (p.draft.kind === 'image' && sam3Available) {
              const imageRecord = record as ImageRecord;
              setEncodingIds((prev) => {
                const next = new Set(prev);
                next.add(imageRecord.id);
                return next;
              });
              void precacheImageEncoding(imageRecord).finally(() => {
                setEncodingIds((prev) => {
                  if (!prev.has(imageRecord.id)) return prev;
                  const next = new Set(prev);
                  next.delete(imageRecord.id);
                  return next;
                });
              });
            }
            history.push(
              createEntry({
                created: [next as HistoryMedia],
                setMedia,
                onConn: setConn,
              }),
              { alreadyApplied: true },
            );
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
    [sam3Available, history],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
  }, []);

  const clearSegment = useCallback((id: string) => {
    // Bump the sequence so any in-flight invoke for this id is ignored when
    // it resolves.
    segmentSeqRef.current[id] = (segmentSeqRef.current[id] ?? 0) + 1;
    setSegments((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    deleteAllSegmentationsForImage(id).catch((e) =>
      console.warn('[sam3] clear-persist failed', id, e),
    );
  }, []);

  const submitSegment = useCallback(
    (m: CanvasMedia, tags: string[]) => {
      if (m.kind !== 'image') return;
      if (!sam3Available) return;
      // De-dupe case-insensitively but keep the first-seen casing as the
      // tag's canonical identity — the pill, the mask, and the bbox all
      // key off this exact string via colorForTag.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of tags) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(t);
      }
      if (cleaned.length === 0) {
        clearSegment(m.id);
        return;
      }
      if (!m.collectionId || !m.file) {
        console.warn('[sam3] segment skipped — missing pb metadata for', m.id);
        return;
      }
      const seq = (segmentSeqRef.current[m.id] ?? 0) + 1;
      segmentSeqRef.current[m.id] = seq;
      // Preserve already-ready entries so their masks don't flash to a
      // spinner on re-submit. Only re-invoke tags that are new, errored,
      // or still loading (the seq bump invalidates old in-flight invokes).
      const priorByKey = new Map<string, TagSegment>();
      for (const e of segments[m.id]?.entries ?? []) {
        priorByKey.set(e.tag.toLowerCase(), e);
      }
      const tagsToInvoke: string[] = [];
      const nextEntries: TagSegment[] = cleaned.map((tag) => {
        const prior = priorByKey.get(tag.toLowerCase());
        if (prior && prior.status === 'ready') return prior;
        tagsToInvoke.push(tag);
        return { tag, status: 'loading' };
      });
      setSegments((prev) => ({ ...prev, [m.id]: { entries: nextEntries } }));
      // Drop any persisted rows for tags that are no longer in the set.
      // Fire-and-forget — races with in-flight upserts are fine because the
      // unique (image, lower(tag)) index prevents duplicate rows.
      deleteSegmentationsForImage(m.id, cleaned).catch((e) =>
        console.warn('[sam3] prune failed', m.id, e),
      );

      const updateTag = (tag: string, patch: TagSegment) => {
        if (segmentSeqRef.current[m.id] !== seq) return;
        setSegments((prev) => {
          const current = prev[m.id];
          if (!current) return prev;
          return {
            ...prev,
            [m.id]: {
              entries: current.entries.map((entry) =>
                entry.tag === tag ? patch : entry,
              ),
            },
          };
        });
      };

      // Each tag is a separate prompt — SAM3 is single-object per call and
      // the worker already queues concurrent invokes server-side.
      for (const tag of tagsToInvoke) {
        invoke<SegmentResponse>('sam3_segment_text', {
          id: m.id,
          collectionId: m.collectionId,
          file: m.file,
          text: tag,
        })
          .then((response) => {
            updateTag(tag, { tag, status: 'ready', response });
            // Fire-and-forget: persist the mask to PB so it rehydrates after
            // reload. UI state is authoritative within a session; PB is
            // authoritative across sessions.
            upsertSegmentation({
              image: m.id,
              tag,
              masks: response.masks,
              source_width: response.source_width,
              source_height: response.source_height,
            }).catch((e) => console.warn('[sam3] persist failed', tag, e));
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[sam3] segment failed for ${m.id} (${tag})`, err);
            updateTag(tag, { tag, status: 'error', message });
          });
      }
    },
    [clearSegment, sam3Available, segments],
  );

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
    clearSegment(id);
    const fn = target.kind === 'video' ? deleteVideo : deleteImage;
    fn(id)
      .then(() => {
        setConn('ready');
        history.push(
          deleteEntry({
            deleted: [target as HistoryMedia],
            setMedia,
            onConn: setConn,
            // Keep the SAM3 encoding cache alive during the soft-delete
            // window so undo → re-segment is instant. Drop it only when
            // the entry is evicted (history buffer overflow) and the
            // record is hard-deleted. The launch sweep is the other
            // path; it also calls deleteImageEncoding after hardDelete.
            onHardDelete: (hid, kind) => {
              if (kind === 'image') void deleteImageEncoding(hid);
            },
          }),
          { alreadyApplied: true },
        );
        if (lodCache) void lodCache.delete(id);
        dropAsset(id);
      })
      .catch((err) => {
        console.warn('[pb] delete failed for', id, err);
        setConn('offline');
        setMedia((prev) => [...prev, target]);
      });
  }, [clearSegment, history, lodCache, dropAsset]);

  // Batched multi-delete: one history entry covers every soft-deleted item
  // in the current selection so Cmd-Z restores them all atomically. Pending
  // uploads are aborted individually — they have no server state to undo, so
  // they don't participate in the entry. If the selection contains only
  // pending items, no entry is pushed (nothing to undo).
  const deleteSelection = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const targets = mediaRef.current.filter((m) => idSet.has(m.id));
    if (targets.length === 0) return;

    const pending = targets.filter((t) => t.pending);
    const live = targets.filter((t) => !t.pending);

    setMedia((prev) => prev.filter((m) => !idSet.has(m.id)));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setLastSelectedId((cur) => (cur && idSet.has(cur) ? null : cur));
    setHoverId((cur) => (cur && idSet.has(cur) ? null : cur));

    for (const t of pending) {
      uploadCtrlsRef.current[t.id]?.abort();
      URL.revokeObjectURL(t.src);
    }
    for (const t of live) clearSegment(t.id);

    if (live.length === 0) return;

    Promise.all(
      live.map((t) =>
        (t.kind === 'video' ? deleteVideo : deleteImage)(t.id),
      ),
    )
      .then(() => {
        setConn('ready');
        history.push(
          deleteEntry({
            deleted: live as HistoryMedia[],
            setMedia,
            onConn: setConn,
            onHardDelete: (hid, kind) => {
              if (kind === 'image') void deleteImageEncoding(hid);
            },
          }),
          { alreadyApplied: true },
        );
      })
      .catch((err) => {
        console.warn('[pb] batch delete failed', err);
        setConn('offline');
        setMedia((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const restored = live.filter((t) => !have.has(t.id));
          return [...prev, ...restored];
        });
      });
  }, [clearSegment, history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // The HighlightInput autofocuses when a single item is selected, so
        // cycling lands us back in a typing context on every other press.
        // Treat it as a navigation companion — Tab there still cycles.
        const tgt = e.target instanceof Element ? e.target : null;
        const activeEl =
          document.activeElement instanceof Element ? document.activeElement : null;
        const inHighlightInput =
          tgt?.closest('.highlight-input') != null ||
          activeEl?.closest('.highlight-input') != null;
        if (!inHighlightInput && isTypingContext(e)) return;
        const list = mediaRef.current.filter((m) => !m.pending);
        if (list.length === 0) return;
        e.preventDefault();
        const selIds = selectedIdsRef.current;
        const anchorId =
          (lastSelectedIdRef.current && selIds.has(lastSelectedIdRef.current)
            ? lastSelectedIdRef.current
            : null) ??
          (selIds.size > 0 ? Array.from(selIds).pop() ?? null : null);
        const currentIndex = anchorId
          ? list.findIndex((m) => m.id === anchorId)
          : -1;
        const dir = e.shiftKey ? -1 : 1;
        const nextIndex =
          currentIndex === -1
            ? dir === 1
              ? 0
              : list.length - 1
            : (currentIndex + dir + list.length) % list.length;
        const target = list[nextIndex];
        if (!target) return;
        clearHideTimer();
        setSelectedIds(new Set([target.id]));
        setLastSelectedId(target.id);
        setHoverId(target.id);
        canvasRef.current?.focusOn(
          { x: target.x, y: target.y, width: target.width, height: target.height },
          { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
        );
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
  }, [clearSelection, deleteSelection, selectAll, duplicateSelection, clearHideTimer]);

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

  const importDescriptors = useCallback(
    async (descriptors: MediaDescriptor[], point: WorldPoint) => {
      const files: { file: File; kind: 'image' | 'video' }[] = [];
      for (const d of descriptors) {
        try {
          const f = await d.load();
          files.push({ file: f, kind: d.kind });
        } catch (err) {
          console.error('[ingest] load failed', d.relativePath, err);
        }
      }
      if (!files.length) return;

      const rawLoaded = await Promise.all(
        files.map(async ({ file, kind }) => {
          const dims = await (kind === 'video' ? loadVideo(file) : loadImage(file));
          return { file, kind, ...dims };
        }),
      );

      // Normalize each new item's longest side to match the existing canvas
      // median (or a default when empty) so a tiny icon and a 4k photo don't
      // land next to each other at wildly different scales. Aspect ratio is
      // preserved; the original file is still uploaded unchanged — only the
      // placed world dimensions are scaled.
      const reference = mediaRef.current.filter((m) => !m.pending);
      const loaded = rawLoaded.map((l) => ({
        ...l,
        ...normalizeUploadSize({ width: l.width, height: l.height }, reference),
      }));

      const gap = 32;
      const placements = placeGrid(
        loaded.map((l) => ({ width: l.width, height: l.height })),
        point,
        gap,
      );

      const plan: UploadPlan[] = loaded.map((l, i) => {
        const r = placements[i]!;
        const meta = {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          name: l.file.name,
        };
        return {
          draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
          file: l.file,
          meta,
        };
      });

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
    },
    [runUploadPlan],
  );

  const preview = useImportPreview();

  const handleDrop = useCallback(
    (dt: DataTransfer, point: WorldPoint) => {
      const captured = captureDataTransfer(dt);
      if (captured.entries.length === 0 && captured.fallbackFiles.length === 0) {
        return;
      }
      if (!dropContainsFolderOrZip(captured)) {
        void (async () => {
          const budget = { bytesUsed: 0, limit: Number.MAX_SAFE_INTEGER };
          const descs: MediaDescriptor[] = [];
          for (const f of captured.fallbackFiles) {
            const d = await buildDescriptorFromFile(f, f.name, budget);
            descs.push(...d);
          }
          // Most browsers expose drops via `webkitGetAsEntry`, populating
          // `entries` instead of `fallbackFiles`. The folder/zip gate above
          // already excluded directory entries, so anything left here is a
          // single FileSystemFileEntry we can resolve to a File directly.
          for (const entry of captured.entries) {
            if (!entry || !entry.isFile) continue;
            const fileEntry = entry as FileSystemFileEntry;
            const file = await new Promise<File>((resolve, reject) =>
              fileEntry.file(resolve, reject),
            );
            const d = await buildDescriptorFromFile(file, file.name, budget);
            descs.push(...d);
          }
          if (descs.length) await importDescriptors(descs, point);
        })();
        return;
      }

      preview.setPendingPoint(point);
      void preview.start({
        kind: 'data-transfer',
        captured,
        label: describeDrop(captured),
      });
    },
    [importDescriptors, preview],
  );

  const onConfirmImport = useCallback(() => {
    const point = preview.getPendingPoint();
    const descs = preview.state.descriptors;
    preview.close();
    if (point && descs.length) void importDescriptors(descs, point);
  }, [importDescriptors, preview]);

  useEffect(() => {
    return subscribeTauriDrops(({ paths, position }) => {
      if (!paths.length) return;
      const rect = document.documentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const clientX = position.x / dpr;
      const clientY = position.y / dpr;
      const view = canvasRef.current?.getView();
      if (!view) return;
      const worldX = (clientX - rect.left - view.x) / view.scale;
      const worldY = (clientY - rect.top - view.y) / view.scale;
      const point: WorldPoint = { worldX, worldY };
      preview.setPendingPoint(point);

      // Tauri drops always go through scanTauriPaths — scan_paths classifies
      // files vs folders reliably (no extension-heuristic misroutes).
      const label =
        paths.length === 1
          ? (paths[0]!.split(/[\\/]/).pop() ?? paths[0]!)
          : `${paths.length} sources`;
      void preview.start({
        kind: 'generator',
        label,
        makeGenerator: (signal) => scanTauriPaths(paths, signal),
      });
    });
  }, [preview, importDescriptors]);

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
        // Suppress clearSelection when the pointer ends on a floating
        // overlay (media-toolbar, highlight-input, popover). The toolbar
        // animates in over the cursor after pointerdown, so a stationary
        // click that started on the canvas and ended on the toolbar
        // should let the toolbar's own click handler run — not deselect
        // the image. Overlays live outside .ic-root.
        const target = e.target instanceof Element ? e.target : null;
        const endedOnOverlay = !!target && !target.closest('.ic-root');
        if (!m.additive && !endedOnOverlay) clearSelection();
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
    if (toolRef.current === 'box') {
      // Box tool disables move-to-drag on media. Selection (via click) still
      // works because handleMediaClick runs on pointerup with no dragRef set.
      // Box-drawing pointer logic will hook in here in a follow-up.
      return;
    }
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
      const moves: Array<{
        id: string;
        kind: 'image' | 'video';
        from: { x: number; y: number };
        to: { x: number; y: number };
      }> = [];
      for (const [id, o] of orig) {
        const stillPending = currentMedia.find((m) => m.id === id)?.pending;
        if (stillPending) continue;
        const persist =
          o.kind === 'video' ? updateVideoPosition : updateImagePosition;
        const nextX = o.x + lastDx;
        const nextY = o.y + lastDy;
        moves.push({
          id,
          kind: o.kind,
          from: { x: o.x, y: o.y },
          to: { x: nextX, y: nextY },
        });
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
      if (moves.length > 0) {
        history.push(
          moveEntry({ moves, setMedia, onConn: setConn }),
          { alreadyApplied: true },
        );
      }
    },
    [history],
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
        onDataTransferDrop={handleDrop}
        onBackgroundPointerDown={handleBackgroundPointerDown}
        zoomSensitivity={settings.zoomSensitivity}
        panSpeed={settings.panSpeed}
      >
        {paintMedia.map((m) => {
          const lod = lodSources.get(m.id);
          return (
            <MediaItem
              key={m.id}
              m={m}
              isActive={activeSet.has(m.id)}
              placement={labelPlacements.get(m.id) ?? 'tl'}
              lodSrc={lod?.lodSrc}
              playVideo={lod ? lod.playVideo : true}
              onEnter={handleMediaEnter}
              onLeave={handleMediaLeave}
              onClick={handleMediaClick}
              onDoubleClick={handleMediaDoubleClick}
              onContextMenu={handleMediaContextMenu}
              onPointerDown={handleMediaPointerDown}
              onPointerMove={handleMediaPointerMove}
              onPointerUp={handleMediaPointerUp}
            />
          );
        })}
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

      {visibleMedia
        .filter((m) => !m.pending && m.kind === 'image' && encodingIds.has(m.id))
        .map((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          const showLabel = rw > 110 && rh > 48;
          return (
            <div
              key={`encoding-${m.id}`}
              className="encoding-overlay"
              style={{ left: rx, top: ry, width: rw, height: rh }}
              role="status"
              aria-live="polite"
              aria-label="Encoding image for SAM3"
            >
              <div className="encoding-chip">
                <span className="encoding-spinner" aria-hidden />
                {showLabel && <span className="encoding-label">Encoding</span>}
              </div>
            </div>
          );
        })}

      {visibleMedia
        .filter((m) => m.kind === 'image' && segments[m.id])
        .flatMap((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          const state = segments[m.id]!;
          const base = `segment-${m.id}`;
          const nodes: JSX.Element[] = [];

          // Per-tag masks + boxes, each recolored by its tag identity so
          // the pill, mask fill, and bounding box share one hue.
          for (const entry of state.entries) {
            if (entry.status !== 'ready') continue;
            const { accent } = colorForTag(entry.tag);
            entry.response.masks.forEach((mask, idx) => {
              const maskKey = `${base}-${entry.tag}-mask-${idx}`;
              nodes.push(
                <div
                  key={maskKey}
                  className="segment-mask"
                  style={{
                    left: rx,
                    top: ry,
                    width: rw,
                    height: rh,
                    backgroundColor: accent,
                    opacity: 0.5,
                    WebkitMaskImage: `url(data:image/png;base64,${mask.png_base64})`,
                    maskImage: `url(data:image/png;base64,${mask.png_base64})`,
                    WebkitMaskSize: '100% 100%',
                    maskSize: '100% 100%',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                  }}
                  aria-hidden
                />,
              );
              // Bounding box is in mask-pixel coordinates; translate to
              // screen coordinates via the mask's own width/height so it
              // rides the image through pan/zoom.
              if (mask.bbox && mask.width > 0 && mask.height > 0) {
                const [x1, y1, x2, y2] = mask.bbox;
                const fx = rw / mask.width;
                const fy = rh / mask.height;
                const bx = rx + x1 * fx;
                const by = ry + y1 * fy;
                const bw = Math.max(1, (x2 - x1) * fx);
                const bh = Math.max(1, (y2 - y1) * fy);
                nodes.push(
                  <div
                    key={`${base}-${entry.tag}-box-${idx}`}
                    className="segment-bbox"
                    style={{
                      left: bx,
                      top: by,
                      width: bw,
                      height: bh,
                      borderColor: accent,
                    }}
                    aria-hidden
                  />,
                );
              }
            });
          }

          const loadingTags = state.entries.filter((e) => e.status === 'loading');
          const errorTags = state.entries.filter(
            (e): e is Extract<TagSegment, { status: 'error' }> => e.status === 'error',
          );

          if (loadingTags.length > 0 || errorTags.length > 0) {
            nodes.push(
              <div
                key={`${base}-chips`}
                className="segment-overlay segment-overlay--chips"
                style={{ left: rx, top: ry, width: rw, height: rh }}
                aria-hidden
              >
                <div className="segment-chip-stack">
                  {loadingTags.map((entry) => {
                    const { bg, fg, border } = colorForTag(entry.tag);
                    return (
                      <div
                        key={`loading-${entry.tag}`}
                        className="segment-chip"
                        style={{
                          background: bg,
                          color: fg,
                          borderColor: border,
                        }}
                        role="status"
                        aria-live="polite"
                        aria-label={`Segmenting "${entry.tag}"`}
                      >
                        <span className="encoding-spinner" aria-hidden />
                        <span className="encoding-label">{entry.tag}</span>
                      </div>
                    );
                  })}
                  {errorTags.map((entry) => {
                    const { bg, fg, border } = colorForTag(entry.tag);
                    return (
                      <div
                        key={`error-${entry.tag}`}
                        className="segment-chip segment-chip--error"
                        style={{
                          background: bg,
                          color: fg,
                          borderColor: border,
                        }}
                        role="alert"
                        title={entry.message}
                      >
                        <i className="ri-error-warning-line" aria-hidden />
                        <span className="encoding-label">
                          No match — {entry.tag}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>,
            );
          }

          return nodes;
        })}

      {tool === 'box' && activeMedia && activeRect && cursor && (() => {
        const cx = cursor.worldX * view.scale + view.x;
        const cy = cursor.worldY * view.scale + view.y;
        if (
          cx < activeRect.x ||
          cx > activeRect.x + activeRect.width ||
          cy < activeRect.y ||
          cy > activeRect.y + activeRect.height
        ) {
          return null;
        }
        return (
          <div
            className="box-crosshair"
            aria-hidden
            style={{
              left: activeRect.x,
              top: activeRect.y,
              width: activeRect.width,
              height: activeRect.height,
            }}
          >
            <span
              className="box-crosshair-line is-vertical"
              style={{ left: cx - activeRect.x }}
            />
            <span
              className="box-crosshair-line is-horizontal"
              style={{ top: cy - activeRect.y }}
            />
          </div>
        );
      })()}

      {activeMedia && activeRect && (
        <MediaToolbar
          rect={activeRect}
          tool={tool}
          onToolChange={setTool}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
        />
      )}

      {activeMedia && activeRect && (
        <HighlightInput
          key={activeMedia.id}
          rect={activeRect}
          tags={highlightInputs[activeMedia.id] ?? (EMPTY_TAGS as string[])}
          onTagsChange={(next) => {
            setHighlightInputs((prev) => ({ ...prev, [activeMedia.id]: next }));
            if (next.length === 0) clearSegment(activeMedia.id);
          }}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onFocus={() => {
            clearHideTimer();
            setSelectedIds(new Set([activeMedia.id]));
            setLastSelectedId(activeMedia.id);
          }}
          onBlur={() => {
            const current = highlightInputs[activeMedia.id] ?? [];
            if (current.length === 0) clearSelection();
            scheduleHide();
          }}
          onEscape={() => {
            clearSelection();
            scheduleHide();
          }}
          onSubmit={(next) => submitSegment(activeMedia, next)}
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
          key={multiSelectKey}
          rect={{
            x: selectionBBox.minX * view.scale + view.x,
            y: selectionBBox.minY * view.scale + view.y,
            width: Math.max(0, (selectionBBox.maxX - selectionBBox.minX) * view.scale),
            height: Math.max(0, (selectionBBox.maxY - selectionBBox.minY) * view.scale),
          }}
          tags={multiHighlightInput}
          onTagsChange={setMultiHighlightInput}
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
          <span className="wordmark-divider" aria-hidden />
          {sam3Error ? (
            <span className="wordmark-tag sam3-error-tag" role="alert" title={sam3Error}>
              SAM3 Error
            </span>
          ) : (
            <Sam3VersionBadge />
          )}
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
        <SavedTagsPopover />
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

      <ImportPreviewModal
        state={preview.state}
        onCancel={preview.cancel}
        onImport={onConfirmImport}
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
