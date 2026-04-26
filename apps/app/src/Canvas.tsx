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
  deleteSegmentationByImageTag,
  deleteSegmentationsForImage,
  deleteImage,
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
import { colorForTag, useSavedTags } from './components/savedTags';
import { FloatingSidebar } from './components/FloatingSidebar';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { SettingsModal } from './components/SettingsModal';
import { Sam3VersionBadge } from './components/Sam3VersionBadge';
import { SavedTagsPopover } from './components/SavedTagsPopover';
import { SearchPalette, type SearchItem } from './components/SearchPalette';
import { MediaToolbar, type CanvasTool } from './components/MediaToolbar';
import { MediaTagList } from './components/MediaTagList';
import { useAutoLiquidGlassFilter } from './components/LiquidGlass';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import {
  computeLabelPlacements,
  type LabelPlacement,
} from './lib/labelPlacement';
import { labelOuterWidth } from './lib/labelMetrics';
import { groupSegmentationsByImage } from './lib/segmentations';
import {
  SegmentBakeLayer,
  BboxOverlayLayer,
  evictBake,
  deleteMaskEntry,
  resizeBboxEntry,
  nextSoloTag,
  type BboxOverlayRect,
  type MaskIdentity,
  type ReadyMaskEntry,
} from './features/segmentation';
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
import { runAnnotationPlan } from './lib/annotations';
import type { AnnotationFormat, AnnotationPlan } from './lib/annotations';
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
import {
  ProjectChip,
  DeletedBanner,
  DeleteProjectModal,
  useProject,
  useProjectThumbnail,
  updateProject,
} from './features/projects';
import { setCanvasTitle, closeCurrentCanvas, focusHome } from './lib/windows';
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

type DrawBoxState = {
  imageId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  // World-space corners, clamped to the target image's bounds.
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  // Image world-bounds captured at drag-start so the clamp stays stable even
  // if the image is re-rendered during the drag.
  imageX: number;
  imageY: number;
  imageW: number;
  imageH: number;
  moved: boolean;
};

/** A user-drawn bounding box. Stored relative to the image's world top-left
 *  so it follows the image when dragged. [x1, y1, x2, y2] in the image's
 *  world units (i.e. offsets of `m.width`/`m.height`). */
type UserBox = {
  id: string;
  box: [number, number, number, number];
  /** User-supplied label captured at draw time. Used as the segment tag so
   *  the SAM3 mask renders under a meaningful name. */
  label: string;
};

/** A box that's been drawn but not yet labeled. While set, a popover prompts
 *  the user for a label; on confirm we commit the box + dispatch SAM3, on
 *  cancel we discard. `worldRect` is snapshotted so the popover follows
 *  pan/zoom without re-reading the image's live position (image moves are
 *  unlikely while the modal is open, but the snapshot makes it robust). */
type PendingBoxLabel = {
  imageId: string;
  boxId: string;
  relBox: [number, number, number, number];
  imageW: number;
  imageH: number;
  worldRect: { x1: number; y1: number; x2: number; y2: number };
};

const DRAW_BOX_MIN_SIZE_PX = 4;
const genBoxId = (): string =>
  `ub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type UploadPhase = 'sending' | 'finalizing' | 'error';
type UploadStatus = { phase: UploadPhase; pct: number; message?: string };

type SegMask = {
  png_base64: string;
  edge_png_base64?: string;
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
  | { tag: string; status: 'loading'; kind?: 'box'; boxId?: string }
  | { tag: string; status: 'ready'; response: SegmentResponse; kind?: 'box'; boxId?: string }
  | { tag: string; status: 'error'; message: string; kind?: 'box'; boxId?: string };

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

// Effectively disables viewport culling. At 0.5 (the previous value),
// zooming in on one image unmounted the others; zooming back out
// remounted them in a burst, and the mass re-composition blanked the
// entire WKWebView window until another input forced a re-raster.
// Keeping everything mounted trades a bit of memory for a stable
// compositor — the per-item DOM is cheap, and paintable content is
// already bounded by the active canvas, not history.
const CULL_BUFFER_FACTOR = 50;

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

// Survives MediaItem unmount/remount. Viewport culling in Canvas unmounts
// off-screen items; on zoom-back they remount fresh, and without this set
// would flash through the pop-in animation every time.
const loadedMediaIds = new Set<string>();

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
  const [loaded, setLoaded] = useState(() => loadedMediaIds.has(m.id));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // Cached media can finish loading before React attaches onLoad, so the
    // event never fires on remount. Reconcile against the DOM state once.
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      loadedMediaIds.add(m.id);
      setLoaded(true);
      return;
    }
    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      loadedMediaIds.add(m.id);
      setLoaded(true);
    }
  }, [m.id]);

  const handleLoaded = () => {
    loadedMediaIds.add(m.id);
    setLoaded(true);
  };
  // Flip visible on error too, otherwise the broken-image icon stays hidden.
  const handleError = () => {
    loadedMediaIds.add(m.id);
    setLoaded(true);
  };

  const cls = `world-image ${m.pending ? 'is-pending' : ''} ${isActive ? 'is-active' : ''} ${loaded ? 'is-loaded' : ''}`;
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
            ref={imgRef}
            src={lodSrc ?? m.src}
            alt={m.name}
            draggable={false}
            decoding="async"
            className={cls}
            style={style}
            onLoad={handleLoaded}
            onError={handleError}
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
          ref={videoRef}
          src={m.src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className={cls}
          style={style}
          onLoadedData={handleLoaded}
          onError={handleError}
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
        ref={imgRef}
        src={lodSrc ?? m.src}
        alt={m.name}
        draggable={false}
        decoding="async"
        className={cls}
        style={style}
        onLoad={handleLoaded}
        onError={handleError}
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
  projectId: string;
  /** When set, SAM3 failed to load. Encode/segment calls are skipped and a
   *  compact error chip is shown in the top-left HUD. */
  sam3Error?: string | null;
};

// Memoized per-image bake-layer wrapper. Stabilizes the `masksInput` array
// ref and pointer-handler refs across parent re-renders so the inner
// SegmentBakeLayer's React.memo actually bails out when nothing material
// changed. This is the hot path on pan/zoom (Canvas re-renders once per
// animation frame via the view rAF), so ref stability matters.
type BakeForImageProps = {
  m: CanvasMedia;
  state: SegmentState;
  // View filter: when set, only masks for this tag are baked. Passed as
  // `null` for non-active images so their memoized bake never re-runs.
  soloTag: string | null;
  onMaskSelect: (id: { imageId: string; tag: string; maskIndex: number }) => void;
  onMaskHover: (id: MaskIdentity | null) => void;
  onEmptyPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};

const BakeForImage = memo(function BakeForImage({
  m,
  state,
  soloTag,
  onMaskSelect,
  onMaskHover,
  onEmptyPointerDown,
  onEnter,
  onLeave,
  onPointerMove,
  onPointerUp,
}: BakeForImageProps) {
  const { masksInput, first } = useMemo(() => {
    const readyEntries = state.entries.filter(
      (e): e is Extract<typeof e, { status: 'ready' }> => e.status === 'ready',
    );
    if (readyEntries.length === 0) {
      return { masksInput: null, first: null };
    }
    const soloLower = soloTag ? soloTag.toLowerCase() : null;
    const visibleEntries = soloLower
      ? readyEntries.filter((e) => e.tag.toLowerCase() === soloLower)
      : readyEntries;
    if (visibleEntries.length === 0) {
      // Solo'd tag has no matching ready entry (shouldn't happen in practice
      // since the list is driven by ready entries, but guard anyway).
      return { masksInput: null, first: readyEntries[0]!.response };
    }
    const built = visibleEntries.flatMap((entry) => {
      const { accent } = colorForTag(entry.tag);
      // `entryId` disambiguates two entries sharing a display tag — two
      // box entries both labeled "cat" each get their own hit-test identity
      // via their unique boxId. Text entries don't need it (tag is unique).
      const entryId = entry.kind === 'box' ? entry.boxId : undefined;
      return entry.response.masks.map((mask, idx) => ({
        tag: entry.tag,
        maskIndex: idx,
        entryId,
        png_base64: mask.png_base64,
        maskW: mask.width,
        maskH: mask.height,
        bbox: mask.bbox,
        accent,
      }));
    });
    return { masksInput: built, first: visibleEntries[0]!.response };
  }, [state, soloTag]);

  const handleEmpty = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      onEmptyPointerDown(e, m);
    },
    [m, onEmptyPointerDown],
  );
  const handleEnter = useCallback(() => onEnter(m.id), [m.id, onEnter]);

  if (!masksInput || !first) return null;

  return (
    <SegmentBakeLayer
      imageId={m.id}
      worldX={m.x}
      worldY={m.y}
      worldWidth={m.width}
      worldHeight={m.height}
      sourceW={first.source_width}
      sourceH={first.source_height}
      masks={masksInput}
      onMaskSelect={onMaskSelect}
      onMaskHover={onMaskHover}
      onEmptyPointerDown={handleEmpty}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
});

type BoxLabelPopoverProps = {
  /** Anchor in viewport pixels — popover positions itself just below this. */
  screenX: number;
  screenY: number;
  /** Maximum width the popover can use; the parent caps it to the box width
   *  so the popover doesn't dwarf a small selection. Falls back to a minimum
   *  via CSS (`min-width`) so an extreme zoom-out doesn't squash the input. */
  maxWidth: number;
  projectId: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
};

/** Popover that captures the user's label for a freshly drawn box.
 *
 *  Behavior: autofocuses on mount; Enter confirms (if non-empty); Esc
 *  cancels; click-outside is intentionally NOT cancel — the user must use a
 *  control or a key, matching Figma's rename pattern (it's too easy to lose
 *  a long label by misclicking). */
function BoxLabelPopover({
  screenX,
  screenY,
  maxWidth,
  projectId,
  onConfirm,
  onCancel,
}: BoxLabelPopoverProps) {
  const [value, setValue] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { search } = useSavedTags(projectId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;
  // No "existing tags" arg — box labels are independent; let the
  // same-session saved-tags store be the suggestion source, unfiltered.
  const suggestions = useMemo(
    () => search(value, [] as string[], 6),
    [search, value],
  );

  // Keep activeIdx in range when suggestion count shrinks.
  useEffect(() => {
    if (activeIdx >= suggestions.length) setActiveIdx(-1);
  }, [suggestions.length, activeIdx]);

  const commit = (label: string) => {
    const clean = label.trim();
    if (clean) onConfirm(clean);
  };

  return (
    <div
      className="box-label-popover"
      role="dialog"
      aria-label="Label this object"
      style={{
        left: screenX,
        top: screenY,
        maxWidth: Math.max(180, maxWidth),
      }}
      onPointerDown={(e) => {
        // Eat pointerdown so it doesn't reach the canvas (which would fire
        // background-pointer-down or start a drag).
        e.stopPropagation();
      }}
    >
      <input
        ref={inputRef}
        className="box-label-input"
        type="text"
        placeholder="Name this object…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActiveIdx(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length > 0) {
            e.preventDefault();
            setActiveIdx((i) => (i + 1) % suggestions.length);
            return;
          }
          if (e.key === 'ArrowUp' && suggestions.length > 0) {
            e.preventDefault();
            setActiveIdx((i) =>
              i <= 0 ? suggestions.length - 1 : i - 1,
            );
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && activeIdx < suggestions.length) {
              commit(suggestions[activeIdx]!);
            } else if (canConfirm) {
              commit(trimmed);
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            if (activeIdx >= 0) {
              setActiveIdx(-1);
              return;
            }
            onCancel();
          }
        }}
        maxLength={64}
        aria-label="Object label"
        autoComplete="off"
        spellCheck={false}
      />
      {/* Autocomplete list of previously-used tags. Matches HighlightInput's
          suggestion UI so the two prompt surfaces feel consistent. */}
      {suggestions.length > 0 && (
        <ul
          className="highlight-suggestions"
          role="listbox"
          onPointerDown={(e) => e.preventDefault()}
        >
          {suggestions.map((tag, i) => {
            const palette = colorForTag(tag);
            const active = i === activeIdx;
            return (
              <li key={`sugg-${tag}`} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`highlight-suggestion${active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(tag)}
                >
                  <span
                    className="highlight-suggestion-swatch"
                    aria-hidden
                    style={{ background: palette.border }}
                  />
                  <span className="highlight-suggestion-text">{tag}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Keyboard-only affordances — no explicit buttons. ↵ confirms when the
          input is non-empty, esc always cancels. The hint brightens slightly
          once a label is typed so the user gets a small "ready" signal. */}
      <div
        className={`box-label-hint${canConfirm ? ' is-ready' : ''}`}
        aria-hidden
      >
        <kbd>↵</kbd>
        <span>segment</span>
        <span className="box-label-hint-sep">·</span>
        <kbd>esc</kbd>
        <span>cancel</span>
      </div>
    </div>
  );
}

export function Canvas({ projectId, sam3Error = null }: CanvasProps) {
  const sam3Available = !sam3Error;

  const projectState = useProject(projectId);

  useEffect(() => {
    if (projectState.status !== 'ready') return;
    void setCanvasTitle(projectId, projectState.project.name);
  }, [projectId, projectState]);

  // Saved-tags registry shared with HighlightInput so box-prompt labels
  // land in the same autocomplete + recent-tags history.
  const { remember: rememberSavedTag } = useSavedTags(projectId);
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

  const getLodCanvas = useCallback((): HTMLCanvasElement | null => {
    const el = document.querySelector('canvas.lod-layer');
    return el instanceof HTMLCanvasElement ? el : null;
  }, []);
  useProjectThumbnail(projectId, getLodCanvas);

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
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  const [encodingIds, setEncodingIds] = useState<Set<string>>(() => new Set());
  const [segments, setSegments] = useState<Record<string, SegmentState>>({});
  const [selectedMask, setSelectedMask] = useState<MaskIdentity | null>(null);
  const [hoveredMask, setHoveredMask] = useState<MaskIdentity | null>(null);
  // View filter: when set, only this tag's masks/bboxes render on the active
  // image. Cleared when the active image changes, on Esc, or on empty-canvas
  // click (via clearSelection). Scoped implicitly to activeMedia — the tag
  // list is only shown for that image.
  const [soloTag, setSoloTag] = useState<string | null>(null);
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

  // Box-tool drawing state. `drawBoxPreview` is the in-flight rect used for
  // the live overlay; `drawBoxRef` mirrors it for access inside window-level
  // pointer handlers without chasing stale state closures. `userBoxes` holds
  // committed rects keyed by image id.
  const [drawBoxPreview, setDrawBoxPreview] = useState<DrawBoxState | null>(null);
  const drawBoxRef = useRef<DrawBoxState | null>(null);
  const [userBoxes, setUserBoxes] = useState<Record<string, UserBox[]>>({});

  const [pendingBoxLabel, setPendingBoxLabel] = useState<PendingBoxLabel | null>(null);

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

  // Solo-tag is scoped to the currently active image. When the active image
  // changes, drop the filter so the next image starts unfiltered.
  useEffect(() => {
    setSoloTag(null);
  }, [activeMedia?.id]);

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
    // `tauri dev` starts Vite before the Rust binary can boot the
    // PocketBase sidecar, so the first fetch from this effect often
    // races and hits ECONNREFUSED. Retry on a flat 500ms interval
    // until we get at least one successful list — PB is local, so
    // polling is cheap and the user only sees 'offline' for a few
    // hundred ms after PB is reachable. Stops on unmount.
    const RETRY_MS = 500;
    let cancelled = false;
    let retryTimer: number | null = null;
    let loaded = false;
    const load = () => {
      void Promise.all([
        listImages(projectId).then(
          (r) => ({ ok: true as const, records: r }),
          (err) => {
            console.warn('[pb] failed to load images:', err);
            return { ok: false as const, records: [] as ImageRecord[] };
          },
        ),
        listVideos(projectId).then(
          (r) => ({ ok: true as const, records: r }),
          (err) => {
            console.warn('[pb] failed to load videos:', err);
            return { ok: false as const, records: [] as VideoRecord[] };
          },
        ),
        listSegmentations(projectId).then(
          (r) => r,
          (err) => {
            console.warn('[pb] failed to load segmentations:', err);
            return [] as SegmentationRecord[];
          },
        ),
      ]).then(([imgRes, vidRes, segRows]) => {
        if (cancelled) return;
        const anyOk = imgRes.ok || vidRes.ok;
        if (!anyOk) {
          setConn('offline');
          retryTimer = window.setTimeout(load, RETRY_MS);
          return;
        }
        if (loaded) return;
        loaded = true;
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
        initialMediaLoadedRef.current = true;
        setConn('ready');

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
    };
    load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  // Launch-time sweep: hard-delete PB records soft-deleted more than 1 hour
  // ago. Catches sessions that ended before an entry could be evicted from
  // the history stack (quits, crashes, or idle closes).
  //
  // Gated on `conn` reaching a terminal state so the sweep doesn't contend
  // with initial hydration for network/main-thread time, and deferred to an
  // idle callback so it never delays first paint.
  const didSweepRef = useRef(false);
  useEffect(() => {
    if (conn === 'connecting') return;
    if (didSweepRef.current) return;
    didSweepRef.current = true;

    let cancelled = false;
    const runSweep = () => {
      const ONE_HOUR_MS = 60 * 60 * 1000;
      void listTrashed(projectId, { olderThanMs: ONE_HOUR_MS })
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
    };

    let cancelSchedule: () => void;
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(runSweep);
      cancelSchedule = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(runSweep, 0);
      cancelSchedule = () => window.clearTimeout(handle);
    }

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [conn]);

  const mediaRef = useRef(media);
  mediaRef.current = media;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

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
    (
      plan: UploadPlan[],
      onUploaded?: (draftId: string, record: ImageRecord | VideoRecord) => void,
    ): Promise<void> => {
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
                ? await createVideo(projectId, p.file, p.meta, onProgress, ctrl.signal)
                : await createImage(projectId, p.file, p.meta, onProgress, ctrl.signal);
            onUploaded?.(p.draft.id, record);
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
    setSelectedMask(null);
    setSoloTag(null);
  }, []);

  useEffect(() => {
    if (selectedIds.size > 0) setSelectedMask(null);
  }, [selectedIds]);

  // Stable across renders — BakeForImage's memo depends on this not
  // changing ref so it can skip re-renders during pan/zoom.
  const handleMaskSelect = useCallback((id: MaskIdentity) => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
    setSelectedMask(id);
  }, []);

  const handleMaskHover = useCallback((id: MaskIdentity | null) => {
    setHoveredMask((prev) => {
      if (id === prev) return prev;
      if (
        id &&
        prev &&
        id.imageId === prev.imageId &&
        id.tag === prev.tag &&
        id.maskIndex === prev.maskIndex
      ) {
        return prev;
      }
      return id;
    });
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
    deleteAllSegmentationsForImage(projectId, id).catch((e) =>
      console.warn('[sam3] clear-persist failed', id, e),
    );
    evictBake(id);
  }, []);

  const replaceReadyTag = useCallback(
    (imageId: string, tag: string, entry: ReadyMaskEntry | null) => {
      const key = tag.toLowerCase();
      setSegments((prev) => {
        const cur = prev[imageId];
        if (!cur) {
          if (!entry) return prev;
          return { ...prev, [imageId]: { entries: [entry] } };
        }
        const next: TagSegment[] = [];
        let replaced = false;
        for (const e of cur.entries) {
          if (e.tag.toLowerCase() === key) {
            if (entry) {
              next.push(entry);
              replaced = true;
            }
            continue;
          }
          next.push(e);
        }
        if (!replaced && entry) next.push(entry);
        if (next.length === 0) {
          const copy = { ...prev };
          delete copy[imageId];
          return copy;
        }
        return { ...prev, [imageId]: { entries: next } };
      });
    },
    [],
  );

  const deleteMask = useCallback(
    (target: MaskIdentity) => {
      const current = segments[target.imageId];
      if (!current) return;
      const key = target.tag.toLowerCase();
      const ready = current.entries.find(
        (e): e is TagSegment & { status: 'ready' } =>
          e.status === 'ready' && e.tag.toLowerCase() === key,
      );
      if (!ready) return;
      if (
        target.maskIndex < 0 ||
        target.maskIndex >= ready.response.masks.length
      ) {
        return;
      }

      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: {
          ...ready.response,
          masks: [...ready.response.masks],
        },
      };
      const remaining = ready.response.masks.filter(
        (_, idx) => idx !== target.maskIndex,
      );
      const after: ReadyMaskEntry | null =
        remaining.length > 0
          ? {
              tag: ready.tag,
              status: 'ready',
              response: { ...ready.response, masks: remaining },
            }
          : null;

      const entry = deleteMaskEntry({
        projectId,
        imageId: target.imageId,
        tag: ready.tag,
        before,
        after,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      setSelectedMask(null);
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [segments, replaceReadyTag, history],
  );

  const deleteAllMasksForTag = useCallback(
    (imageId: string, tag: string) => {
      const current = segmentsRef.current[imageId];
      if (!current) return;
      const key = tag.toLowerCase();
      const ready = current.entries.find(
        (e): e is TagSegment & { status: 'ready' } =>
          e.status === 'ready' && e.tag.toLowerCase() === key,
      );
      if (!ready) return;

      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: {
          ...ready.response,
          masks: [...ready.response.masks],
        },
      };

      const entry = deleteMaskEntry({
        projectId,
        imageId,
        tag: ready.tag,
        before,
        after: null,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      setSoloTag((prev) =>
        prev && prev.toLowerCase() === key ? null : prev,
      );
      setSelectedMask((prev) =>
        prev && prev.imageId === imageId && prev.tag.toLowerCase() === key
          ? null
          : prev,
      );
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [replaceReadyTag, history],
  );

  const removeSegmentTag = useCallback((id: string, tag: string) => {
    const key = tag.toLowerCase();
    let remainingTags: string[] = [];
    let nothingLeft = false;
    let removed = false;
    setSegments((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const remaining = current.entries.filter((e) => e.tag.toLowerCase() !== key);
      if (remaining.length === current.entries.length) return prev;
      removed = true;
      remainingTags = remaining.map((e) => e.tag);
      if (remaining.length === 0) {
        nothingLeft = true;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: { entries: remaining } };
    });
    if (!removed) return;
    // A late in-flight response for this exact tag is harmless: updateTag
    // maps over existing entries and will no-op once the tag is gone.
    // Other tags on the same image may still be loading — do NOT bump the
    // sequence or their responses would be dropped too.
    if (nothingLeft) {
      deleteAllSegmentationsForImage(projectId, id).catch((e) =>
        console.warn('[sam3] tag-remove persist failed', id, tag, e),
      );
    } else {
      deleteSegmentationsForImage(projectId, id, remainingTags).catch((e) =>
        console.warn('[sam3] tag-remove persist failed', id, tag, e),
      );
    }
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
      // Submits are incremental — merge new tags onto existing masks.
      // Preserve existing ready entries so their masks stay rendered;
      // drop prior loading/error entries whose old invoke would be
      // orphaned by the seq bump, and re-invoke any that reappear in
      // the new tag set.
      const mergedByKey = new Map<string, TagSegment>();
      for (const e of segments[m.id]?.entries ?? []) {
        if (e.status === 'ready') mergedByKey.set(e.tag.toLowerCase(), e);
      }
      const tagsToInvoke: string[] = [];
      for (const tag of cleaned) {
        const key = tag.toLowerCase();
        if (mergedByKey.has(key)) continue;
        mergedByKey.set(key, { tag, status: 'loading' });
        tagsToInvoke.push(tag);
      }
      const nextEntries: TagSegment[] = Array.from(mergedByKey.values());
      setSegments((prev) => ({ ...prev, [m.id]: { entries: nextEntries } }));

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
            upsertSegmentation(projectId, {
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

  /** Send a user-drawn box to SAM3 under the user's chosen label and feed
   *  the response into the segment pipeline. `relBox` is `[x1, y1, x2, y2]`
   *  in image-relative world units; we normalize to `[0, 1]` for the worker.
   *  The `label` becomes the segment tag, so the chip displays the user's
   *  name and the mask renders under that color. `kind: 'box'` is preserved
   *  so consumers can tell box-derived entries apart from text-derived ones.
   *
   *  Collisions on label are handled the same way as the text path: tags are
   *  unique by `tag.toLowerCase()`, so re-using a label replaces the prior
   *  entry. The corresponding userBox is left in place — fine for now,
   *  revisit when boxes get a deletion UI. */
  const dispatchBoxPrompt = useCallback(
    (
      imageId: string,
      boxId: string,
      label: string,
      relBox: [number, number, number, number],
      imageW: number,
      imageH: number,
    ) => {
      if (!sam3Available) return;
      const m = mediaRef.current.find((it) => it.id === imageId);
      if (!m || m.kind !== 'image' || !m.collectionId || !m.file) return;
      if (imageW <= 0 || imageH <= 0) return;
      const tag = label;
      const norm: [number, number, number, number] = [
        Math.max(0, Math.min(1, relBox[0] / imageW)),
        Math.max(0, Math.min(1, relBox[1] / imageH)),
        Math.max(0, Math.min(1, relBox[2] / imageW)),
        Math.max(0, Math.min(1, relBox[3] / imageH)),
      ];
      if (norm[2] <= norm[0] || norm[3] <= norm[1]) return;

      // Snapshot the current sequence so a later clearSegment(imageId) bump
      // discards this in-flight invoke — same convention as the text path.
      // Box entries are keyed by `boxId` (not lowercase tag) so two boxes
      // with the same user label each get their own segment entry and the
      // later one doesn't clobber the earlier's mask.
      const seq = segmentSeqRef.current[imageId] ?? 0;
      const updateEntry = (patch: TagSegment) => {
        if ((segmentSeqRef.current[imageId] ?? 0) !== seq) return;
        setSegments((prev) => {
          const cur = prev[imageId] ?? { entries: [] };
          const next: TagSegment[] = [];
          let replaced = false;
          for (const e of cur.entries) {
            if (e.kind === 'box' && e.boxId === boxId) {
              next.push(patch);
              replaced = true;
            } else {
              next.push(e);
            }
          }
          if (!replaced) next.push(patch);
          return { ...prev, [imageId]: { entries: next } };
        });
      };

      updateEntry({ tag, status: 'loading', kind: 'box', boxId });

      invoke<SegmentResponse>('sam3_segment_box', {
        id: imageId,
        collectionId: m.collectionId,
        file: m.file,
        bbox: norm,
      })
        .then((response) => {
          updateEntry({ tag, status: 'ready', response, kind: 'box', boxId });
          // Snap the user's drawn box to the segmentation's tight-fit bbox
          // (from the highest-scoring mask). Feels like "drag a box, it
          // snaps around the actual object" — the UX gain worth the extra
          // state update. Mask bbox is in MASK pixel coords (the PNG dims),
          // so rescale to the image's world units before storing.
          // Remove the user-drawn rectangle — its only job was to carry the
          // prompt and show the loading scan. Now that the mask is ready,
          // `BboxOverlayLayer` renders the segmentation's tight-fit bbox
          // (same chrome as text-prompt segments), so keeping the userBox
          // would duplicate it.
          setUserBoxes((prev) => {
            const list = prev[imageId];
            if (!list) return prev;
            const next = list.filter((b) => b.id !== boxId);
            if (next.length === list.length) return prev;
            if (next.length === 0) {
              const copy = { ...prev };
              delete copy[imageId];
              return copy;
            }
            return { ...prev, [imageId]: next };
          });
          // Persist the mask under the user's label so it rehydrates after
          // reload. The user-drawn box rectangle itself is still
          // session-local; only the resulting segmentation is durable.
          upsertSegmentation(projectId, {
            image: imageId,
            tag,
            masks: response.masks,
            source_width: response.source_width,
            source_height: response.source_height,
          }).catch((e) => console.warn('[sam3] persist failed', tag, e));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[sam3] segment box failed for ${imageId} (${boxId})`, err);
          updateEntry({ tag, status: 'error', message, kind: 'box', boxId });
        });
    },
    [sam3Available],
  );

  /** Confirm the pending box: commit it to `userBoxes` under the trimmed
   *  label, register the label as a chip in `highlightInputs` so it shows
   *  in the same tag list as text-prompted segments, and dispatch SAM3.
   *  Empty/whitespace labels are rejected so the popover stays open. */
  const confirmPendingBoxLabel = useCallback(
    (rawLabel: string) => {
      const label = rawLabel.trim();
      if (!label) return;
      const p = pendingBoxLabel;
      if (!p) return;
      setUserBoxes((prev) => {
        const list = prev[p.imageId] ?? [];
        return {
          ...prev,
          [p.imageId]: [...list, { id: p.boxId, box: p.relBox, label }],
        };
      });
      // Box labels are NOT added to `highlightInputs` — that input is for
      // text-prompt tags the user types directly. Box entries still appear
      // in the MediaTagList (driven by `segments`), just not in the text
      // chip strip, so the two prompt surfaces stay conceptually separate.
      // DO register the label in saved-tags so it surfaces in autocomplete
      // for later text prompts, matching HighlightInput's commitTag path.
      // Surface failures — silently swallowing breaks the Home label list
      // and the saved-tags popover with no diagnostic.
      rememberSavedTag(label).catch((err) =>
        console.warn('[box-prompt] rememberSavedTag failed', err),
      );
      dispatchBoxPrompt(p.imageId, p.boxId, label, p.relBox, p.imageW, p.imageH);
      setPendingBoxLabel(null);
    },
    [pendingBoxLabel, dispatchBoxPrompt, rememberSavedTag],
  );

  const cancelPendingBoxLabel = useCallback(() => {
    setPendingBoxLabel(null);
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
        evictBake(id);
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

  // Tool shortcuts — only meaningful while the floating media toolbar is
  // visible, which is exactly when there's an active media. Keep them off
  // when the user is typing (label input, popovers, etc).
  useEffect(() => {
    if (!activeMedia) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'v') {
        e.preventDefault();
        setTool('drag');
      } else if (k === 'b') {
        e.preventDefault();
        setTool('box');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMedia]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedMask) return;
      // Don't hijack text inputs.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      deleteMask(selectedMask);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedMask, deleteMask]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingContext(e)) return;
      if (!activeMedia || activeMedia.kind !== 'image') return;
      if (!soloTag) return;
      const entries = segmentsRef.current[activeMedia.id]?.entries;
      if (!entries || entries.length === 0) return;
      const dir = e.key === 'ArrowDown' ? 'next' : 'prev';
      const next = nextSoloTag(
        soloTag,
        entries.map((en) => ({ tag: en.tag, status: en.status })),
        dir,
      );
      if (!next) return;
      e.preventDefault();
      setSoloTag(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMedia, soloTag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e)) return;
      if (!activeMedia || activeMedia.kind !== 'image') return;
      if (!soloTag) return;
      // Defer to the existing mask-delete handler when a specific mask is
      // selected — that path deletes one mask, not the whole tag.
      if (selectedMask) return;
      // The pill's own button-level onKeyDown already handles Delete when a
      // pill is focused. Skip here to avoid double-firing (and pushing two
      // history entries) as the native event bubbles to window.
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.media-tag-list')) return;
      e.preventDefault();
      deleteAllMasksForTag(activeMedia.id, soloTag);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMedia, soloTag, selectedMask, deleteAllMasksForTag]);

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
    async (
      descriptors: MediaDescriptor[],
      point: WorldPoint,
      annotationPlan: AnnotationPlan | null = null,
      chosenFormat: AnnotationFormat | 'none' = 'none',
    ) => {
      const mediaDescriptors = descriptors.filter(
        (d): d is MediaDescriptor & { kind: 'image' | 'video' } =>
          d.kind === 'image' || d.kind === 'video',
      );
      const files: { file: File; kind: 'image' | 'video' }[] = [];
      const descriptorsForFiles: (MediaDescriptor & { kind: 'image' | 'video' })[] = [];
      for (const d of mediaDescriptors) {
        try {
          const f = await d.load();
          files.push({ file: f, kind: d.kind });
          descriptorsForFiles.push(d);
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

      const descriptorByDraftId = new Map<string, MediaDescriptor & { kind: 'image' | 'video' }>();
      for (let i = 0; i < plan.length; i++) {
        descriptorByDraftId.set(plan[i]!.draft.id, descriptorsForFiles[i]!);
      }

      const minX = Math.min(...plan.map((p) => p.draft.x));
      const minY = Math.min(...plan.map((p) => p.draft.y));
      const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
      const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));

      const imageIdByDescriptorPath = new Map<string, string>();
      const onUploaded = (draftId: string, record: ImageRecord | VideoRecord) => {
        const desc = descriptorByDraftId.get(draftId);
        if (desc && desc.kind === 'image') {
          imageIdByDescriptorPath.set(desc.relativePath, record.id);
        }
      };

      const uploading = runUploadPlan(plan, onUploaded);
      canvasRef.current?.focusOn(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        { bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
      await uploading;

      if (annotationPlan && chosenFormat !== 'none' && imageIdByDescriptorPath.size > 0) {
        try {
          const { errors } = await runAnnotationPlan({
            plan: annotationPlan,
            chosenFormat,
            descriptors,
            imageIdByDescriptorPath,
            upsert: (group) =>
              upsertSegmentation(projectId, {
                image: group.imageId,
                tag: group.tag,
                masks: group.masks,
                source_width: group.sourceWidth,
                source_height: group.sourceHeight,
              }).then(() => undefined),
          });
          if (errors.length > 0) console.warn('[annotations] errors:', errors);
        } catch (err) {
          console.error('[annotations] plan failed', err);
        }
      }
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
    const plan = preview.state.annotationPlan;
    const format = preview.state.chosenFormat;
    preview.close();
    if (point && descs.length) void importDescriptors(descs, point, plan, format);
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
      // Box tool: click-drag on an image draws a new bounding box. Videos
      // aren't supported yet — fall through to a no-op so they don't drag.
      if (m.kind !== 'image') return;
      // Starting a new draw discards any unlabeled box waiting on a label.
      // Matches Photoshop/Figma "new selection replaces old" semantics.
      setPendingBoxLabel(null);
      const v = viewRef.current;
      // InfiniteCanvas is position:fixed inset:0, so client coords map
      // directly to its local space; no rect offset needed.
      const worldX = (e.clientX - v.x) / v.scale;
      const worldY = (e.clientY - v.y) / v.scale;
      const cx = Math.max(m.x, Math.min(m.x + m.width, worldX));
      const cy = Math.max(m.y, Math.min(m.y + m.height, worldY));
      const state: DrawBoxState = {
        imageId: m.id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: cx,
        startWorldY: cy,
        currentWorldX: cx,
        currentWorldY: cy,
        imageX: m.x,
        imageY: m.y,
        imageW: m.width,
        imageH: m.height,
        moved: false,
      };
      drawBoxRef.current = state;
      setDrawBoxPreview(state);
      // Keep this image active so the toolbar stays anchored to it while
      // drawing. Matches handleMediaClick's single-select behavior.
      if (!selectedIdsRef.current.has(m.id) || selectedIdsRef.current.size !== 1) {
        setSelectedIds(new Set([m.id]));
        setLastSelectedId(m.id);
      }

      const onMove = (ev: PointerEvent) => {
        const b = drawBoxRef.current;
        if (!b || ev.pointerId !== b.pointerId) return;
        const dx = ev.clientX - b.startClientX;
        const dy = ev.clientY - b.startClientY;
        if (!b.moved && Math.hypot(dx, dy) < DRAW_BOX_MIN_SIZE_PX) return;
        const vNow = viewRef.current;
        const wx = (ev.clientX - vNow.x) / vNow.scale;
        const wy = (ev.clientY - vNow.y) / vNow.scale;
        const ccx = Math.max(b.imageX, Math.min(b.imageX + b.imageW, wx));
        const ccy = Math.max(b.imageY, Math.min(b.imageY + b.imageH, wy));
        const next: DrawBoxState = {
          ...b,
          currentWorldX: ccx,
          currentWorldY: ccy,
          moved: true,
        };
        drawBoxRef.current = next;
        setDrawBoxPreview(next);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      const onUp = (ev: PointerEvent) => {
        const b = drawBoxRef.current;
        cleanup();
        if (!b || ev.pointerId !== b.pointerId) return;
        drawBoxRef.current = null;
        setDrawBoxPreview(null);
        if (!b.moved) return;
        const x1 = Math.min(b.startWorldX, b.currentWorldX);
        const y1 = Math.min(b.startWorldY, b.currentWorldY);
        const x2 = Math.max(b.startWorldX, b.currentWorldX);
        const y2 = Math.max(b.startWorldY, b.currentWorldY);
        // Reject degenerate boxes (hairline drags). The pixel threshold is
        // applied in screen space so a zoomed-out drag still needs real
        // motion to commit.
        const vNow = viewRef.current;
        const pxW = (x2 - x1) * vNow.scale;
        const pxH = (y2 - y1) * vNow.scale;
        if (pxW < DRAW_BOX_MIN_SIZE_PX || pxH < DRAW_BOX_MIN_SIZE_PX) return;
        const rel: [number, number, number, number] = [
          x1 - b.imageX,
          y1 - b.imageY,
          x2 - b.imageX,
          y2 - b.imageY,
        ];
        // Park the box in `pendingBoxLabel` and let the popover collect a
        // user label. The box is not committed to `userBoxes` and SAM3 is
        // not invoked until the user confirms — cancel just clears state.
        setPendingBoxLabel({
          imageId: b.imageId,
          boxId: genBoxId(),
          relBox: rel,
          imageW: b.imageW,
          imageH: b.imageH,
          worldRect: { x1, y1, x2, y2 },
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
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

  // Bbox drag-resize on the selected mask. Live edits run through setSegments
  // for instant visual feedback; history is pushed once on pointerup so an
  // entire drag is a single undo step. Eight handles total: four corners for
  // diagonal resize and four edge midpoints for single-axis resize.
  type ResizeHandle = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';
  type BboxResizeDragState = {
    pointerId: number;
    handle: ResizeHandle;
    imageId: string;
    tag: string;
    maskIndex: number;
    startBbox: [number, number, number, number];
    startClientX: number;
    startClientY: number;
    fx: number;
    fy: number;
    maskW: number;
    maskH: number;
    before: ReadyMaskEntry;
    moved: boolean;
  };
  const bboxResizeRef = useRef<BboxResizeDragState | null>(null);
  // Non-null while a drag is actively moving — drives the precision guide
  // overlay. Kept as state (not a ref) so the overlay re-renders when the
  // drag starts and when it ends.
  const [activeResize, setActiveResize] = useState<ResizeHandle | null>(null);

  const applyBboxToSegments = useCallback(
    (
      imageId: string,
      tag: string,
      maskIndex: number,
      nextBbox: [number, number, number, number],
    ) => {
      const key = tag.toLowerCase();
      setSegments((prev) => {
        const cur = prev[imageId];
        if (!cur) return prev;
        let changed = false;
        const nextEntries = cur.entries.map((e) => {
          if (e.status !== 'ready' || e.tag.toLowerCase() !== key) return e;
          const masks = e.response.masks.map((mm, i) => {
            if (i !== maskIndex) return mm;
            const prevBbox = mm.bbox;
            if (
              prevBbox &&
              prevBbox[0] === nextBbox[0] &&
              prevBbox[1] === nextBbox[1] &&
              prevBbox[2] === nextBbox[2] &&
              prevBbox[3] === nextBbox[3]
            ) {
              return mm;
            }
            changed = true;
            return { ...mm, bbox: nextBbox };
          });
          return changed
            ? { ...e, response: { ...e.response, masks } }
            : e;
        });
        if (!changed) return prev;
        return { ...prev, [imageId]: { entries: nextEntries } };
      });
    },
    [],
  );

  const computeResizedBbox = (
    s: BboxResizeDragState,
    clientX: number,
    clientY: number,
  ): [number, number, number, number] => {
    const scale = viewRef.current.scale;
    const dxMask = (clientX - s.startClientX) / scale / s.fx;
    const dyMask = (clientY - s.startClientY) / scale / s.fy;
    let [x1, y1, x2, y2] = s.startBbox;
    const dragsLeft = s.handle === 'tl' || s.handle === 'bl' || s.handle === 'l';
    const dragsRight = s.handle === 'tr' || s.handle === 'br' || s.handle === 'r';
    const dragsTop = s.handle === 'tl' || s.handle === 'tr' || s.handle === 't';
    const dragsBottom = s.handle === 'bl' || s.handle === 'br' || s.handle === 'b';
    if (dragsLeft) x1 = Math.max(0, Math.min(x2 - 1, x1 + dxMask));
    if (dragsRight) x2 = Math.min(s.maskW, Math.max(x1 + 1, x2 + dxMask));
    if (dragsTop) y1 = Math.max(0, Math.min(y2 - 1, y1 + dyMask));
    if (dragsBottom) y2 = Math.min(s.maskH, Math.max(y1 + 1, y2 + dyMask));
    return [x1, y1, x2, y2];
  };

  const handleBboxResizePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLSpanElement>,
      id: MaskIdentity,
      handle: ResizeHandle,
    ) => {
      if (e.button !== 0) return;
      const current = segmentsRef.current[id.imageId];
      if (!current) return;
      const ready = current.entries.find(
        (x): x is TagSegment & { status: 'ready' } =>
          x.status === 'ready' && x.tag.toLowerCase() === id.tag.toLowerCase(),
      );
      if (!ready) return;
      const mask = ready.response.masks[id.maskIndex];
      if (!mask || !mask.bbox) return;
      const mediaItem = mediaRef.current.find((m) => m.id === id.imageId);
      if (!mediaItem || mediaItem.kind !== 'image') return;
      const fx = mediaItem.width / mask.width;
      const fy = mediaItem.height / mask.height;
      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: {
          ...ready.response,
          masks: ready.response.masks.map((mm) => ({ ...mm })),
        },
      };
      bboxResizeRef.current = {
        pointerId: e.pointerId,
        handle,
        imageId: id.imageId,
        tag: ready.tag,
        maskIndex: id.maskIndex,
        startBbox: [...mask.bbox] as [number, number, number, number],
        startClientX: e.clientX,
        startClientY: e.clientY,
        fx,
        fy,
        maskW: mask.width,
        maskH: mask.height,
        before,
        moved: false,
      };
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // pointer capture can fail mid-transition; drag still tracked via ref.
      }
      e.stopPropagation();
      e.preventDefault();
    },
    [],
  );

  const handleBboxResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const s = bboxResizeRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const next = computeResizedBbox(s, e.clientX, e.clientY);
      if (!s.moved) {
        const dx = Math.abs(e.clientX - s.startClientX);
        const dy = Math.abs(e.clientY - s.startClientY);
        if (dx < 1 && dy < 1) return;
        s.moved = true;
        setActiveResize(s.handle);
      }
      applyBboxToSegments(s.imageId, s.tag, s.maskIndex, next);
    },
    [applyBboxToSegments],
  );

  const handleBboxResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const s = bboxResizeRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // Already released or the element is gone; nothing to do.
      }
      bboxResizeRef.current = null;
      setActiveResize(null);
      if (!s.moved) return;
      const finalBbox = computeResizedBbox(s, e.clientX, e.clientY);
      const before = s.before;
      const after: ReadyMaskEntry = {
        tag: before.tag,
        status: 'ready',
        response: {
          ...before.response,
          masks: before.response.masks.map((mm, i) =>
            i === s.maskIndex ? { ...mm, bbox: finalBbox } : mm,
          ),
        },
      };
      // Segments already reflect `after` from the last pointermove, so do()
      // reapplies an equivalent state but still triggers the upsert — mirrors
      // the deleteMaskEntry call site which does the same alreadyApplied dance.
      const entry = resizeBboxEntry({
        projectId,
        imageId: s.imageId,
        tag: s.tag,
        maskIndex: s.maskIndex,
        before,
        after,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [history, replaceReadyTag],
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

  if (projectState.status === 'deleted') return <DeletedBanner />;

  return (
    <>
      <div className="canvas-titlebar" data-tauri-drag-region aria-hidden />
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
        {paintMedia
          .filter((m) => m.kind === 'image' && segments[m.id])
          .map((m) => (
            <BakeForImage
              key={`bake-${m.id}`}
              m={m}
              state={segments[m.id]!}
              soloTag={activeMedia?.id === m.id ? soloTag : null}
              onMaskSelect={handleMaskSelect}
              onMaskHover={handleMaskHover}
              onEmptyPointerDown={handleMediaPointerDown}
              onEnter={handleMediaEnter}
              onLeave={handleMediaLeave}
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

          // Box entries can collide by tag (two boxes labeled "cat"), so
          // dedup by lowercase tag here — one chip per label is plenty for
          // the chip stack and avoids React's duplicate-key warning.
          const dedupByTag = <T extends TagSegment>(arr: T[]): T[] => {
            const seen = new Set<string>();
            const out: T[] = [];
            for (const e of arr) {
              const k = e.tag.toLowerCase();
              if (seen.has(k)) continue;
              seen.add(k);
              out.push(e);
            }
            return out;
          };
          const loadingTags = dedupByTag(
            state.entries.filter((e) => e.status === 'loading'),
          );
          const errorTags = dedupByTag(
            state.entries.filter(
              (e): e is Extract<TagSegment, { status: 'error' }> => e.status === 'error',
            ),
          );

          if (loadingTags.length === 0 && errorTags.length === 0) return [];

          return [
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
          ];
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

      {activeMedia &&
        activeRect &&
        activeMedia.kind === 'image' &&
        (segments[activeMedia.id]?.entries.length ?? 0) > 0 && (
          <MediaTagList
            rect={activeRect}
            entries={(() => {
              // Dedup by tag: two box entries can share a label ("cat"/"cat");
              // the chip list only shows one per label. Prefer a 'ready' entry
              // over loading/error so the final state wins visually.
              const byTag = new Map<string, { tag: string; status: TagSegment['status'] }>();
              for (const e of segments[activeMedia.id]!.entries) {
                const key = e.tag.toLowerCase();
                const prev = byTag.get(key);
                if (!prev || (prev.status !== 'ready' && e.status === 'ready')) {
                  byTag.set(key, { tag: e.tag, status: e.status });
                }
              }
              return Array.from(byTag.values());
            })()}
            onRemove={(tag) => deleteAllMasksForTag(activeMedia.id, tag)}
            onSelect={(tag) => {
              // Toggle: re-clicking the current solo tag clears the filter.
              setSoloTag((prev) =>
                prev && prev.toLowerCase() === tag.toLowerCase() ? null : tag,
              );
            }}
            soloTag={soloTag}
            onMouseEnter={clearHideTimer}
            onMouseLeave={scheduleHide}
          />
        )}

      {activeMedia && activeRect && (
        <HighlightInput
          key={activeMedia.id}
          rect={activeRect}
          tags={highlightInputs[activeMedia.id] ?? (EMPTY_TAGS as string[])}
          onTagsChange={(next) =>
            setHighlightInputs((prev) => ({ ...prev, [activeMedia.id]: next }))
          }
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
          onSubmit={(next) => {
            submitSegment(activeMedia, next);
            setHighlightInputs((prev) =>
              activeMedia.id in prev
                ? { ...prev, [activeMedia.id]: EMPTY_TAGS as string[] }
                : prev,
            );
          }}
          onDeleteWhenEmpty={deleteSelection}
          autoFocus={selectedIds.has(activeMedia.id)}
          projectId={projectId}
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

      {/* Committed user-drawn boxes. Viewport-space so border weight stays
          crisp at every zoom level. Only rendered for images currently in
          paint range to match the segmentation bbox culling.
          A box is "loading" while its matching segment entry (looked up by
          label) is in `status: 'loading'` — i.e. SAM3 is still processing
          the prompt. We render a scan-line overlay during that window so
          the user sees the work in progress on the box itself, in addition
          to the chip in the corner. */}
      {paintMedia
        .filter((m) => m.kind === 'image' && (userBoxes[m.id]?.length ?? 0) > 0)
        .flatMap((m) => {
          const entries = segments[m.id]?.entries ?? [];
          return userBoxes[m.id]!.map((b) => {
            const [rx1, ry1, rx2, ry2] = b.box;
            const wx = m.x + rx1;
            const wy = m.y + ry1;
            const ww = Math.max(1, rx2 - rx1);
            const wh = Math.max(1, ry2 - ry1);
            // Match the segment entry by boxId (one entry per drawn box), not
            // by label — two boxes can share a label ("cat"/"cat") and we
            // still need each to show its own loading/ready/error state.
            const matched = entries.find(
              (e) => e.kind === 'box' && e.boxId === b.id,
            );
            const isLoading = matched?.status === 'loading';
            const isError = matched?.status === 'error';
            const cls = `user-box${isLoading ? ' user-box--loading' : ''}${
              isError ? ' user-box--error' : ''
            }`;
            return (
              <div
                key={`ubox-${m.id}-${b.id}`}
                className={cls}
                aria-hidden
                style={{
                  left: wx * view.scale + view.x,
                  top: wy * view.scale + view.y,
                  width: ww * view.scale,
                  height: wh * view.scale,
                }}
              >
                {isLoading && <span className="user-box-scan" aria-hidden />}
                <span className="user-box-tick tl" />
                <span className="user-box-tick tr" />
                <span className="user-box-tick bl" />
                <span className="user-box-tick br" />
              </div>
            );
          });
        })}

      {/* Live preview of the box being drawn. Matches the committed style
          with reduced opacity so release feels like a "snap". */}
      {drawBoxPreview && drawBoxPreview.moved && (() => {
        const b = drawBoxPreview;
        const x1 = Math.min(b.startWorldX, b.currentWorldX);
        const y1 = Math.min(b.startWorldY, b.currentWorldY);
        const x2 = Math.max(b.startWorldX, b.currentWorldX);
        const y2 = Math.max(b.startWorldY, b.currentWorldY);
        return (
          <div
            className="user-box is-drawing"
            aria-hidden
            style={{
              left: x1 * view.scale + view.x,
              top: y1 * view.scale + view.y,
              width: Math.max(0, (x2 - x1) * view.scale),
              height: Math.max(0, (y2 - y1) * view.scale),
            }}
          >
            <span className="user-box-tick tl" />
            <span className="user-box-tick tr" />
            <span className="user-box-tick bl" />
            <span className="user-box-tick br" />
          </div>
        );
      })()}

      {/* Pending box: drawn but not yet labeled. Shows the box outline and
          anchors the label popover. The outline reuses .user-box without
          .is-drawing so it reads as "committed visual but awaiting input". */}
      {pendingBoxLabel && (() => {
        const r = pendingBoxLabel.worldRect;
        const left = r.x1 * view.scale + view.x;
        const top = r.y1 * view.scale + view.y;
        const width = Math.max(0, (r.x2 - r.x1) * view.scale);
        const height = Math.max(0, (r.y2 - r.y1) * view.scale);
        return (
          <>
            <div
              className="user-box user-box--pending"
              aria-hidden
              style={{ left, top, width, height }}
            >
              <span className="user-box-tick tl" />
              <span className="user-box-tick tr" />
              <span className="user-box-tick bl" />
              <span className="user-box-tick br" />
            </div>
            <BoxLabelPopover
              screenX={left}
              screenY={top + height + 8}
              maxWidth={width}
              projectId={projectId}
              onConfirm={confirmPendingBoxLabel}
              onCancel={cancelPendingBoxLabel}
            />
          </>
        );
      })()}

      {(() => {
        // Dim "at-rest" bboxes are painted to a single viewport-space
        // <canvas> via BboxOverlayLayer. The active (selected / hovered)
        // mask is skipped here and rendered by the block below as DOM so
        // it keeps its resize handles and hover pill.
        const sel = selectedMask;
        const hov = hoveredMask;
        const activeId = activeMedia?.id ?? null;
        const soloLower = soloTag ? soloTag.toLowerCase() : null;
        const rects: BboxOverlayRect[] = [];
        for (const m of paintMedia) {
          if (m.kind !== 'image') continue;
          const state = segments[m.id];
          if (!state) continue;
          for (const entry of state.entries) {
            if (entry.status !== 'ready') continue;
            const tagLower = entry.tag.toLowerCase();
            // Solo only applies to the active image; other images render all
            // their bboxes as usual.
            if (soloLower && m.id === activeId && tagLower !== soloLower) continue;
            const { accent } = colorForTag(entry.tag);
            const entryId = entry.kind === 'box' ? entry.boxId : undefined;
            for (let i = 0; i < entry.response.masks.length; i += 1) {
              const mask = entry.response.masks[i];
              if (!mask || !mask.bbox) continue;
              // Two box entries can share a display tag; match by entryId
              // too so selected/hovered chrome lands on the intended entry.
              const isSel =
                sel &&
                sel.imageId === m.id &&
                sel.tag.toLowerCase() === tagLower &&
                sel.maskIndex === i &&
                sel.entryId === entryId;
              const isHov =
                hov &&
                hov.imageId === m.id &&
                hov.tag.toLowerCase() === tagLower &&
                hov.maskIndex === i &&
                hov.entryId === entryId;
              if (isSel || isHov) continue;
              const [x1, y1, x2, y2] = mask.bbox;
              const fx = m.width / mask.width;
              const fy = m.height / mask.height;
              // Include boxId (when present) in the key so two box entries
              // sharing a tag don't collide on React's key check.
              rects.push({
                key: `${m.id}-${entry.tag}-${entry.kind === 'box' ? entry.boxId ?? '' : ''}-${i}`,
                left: (m.x + x1 * fx) * view.scale + view.x,
                top: (m.y + y1 * fy) * view.scale + view.y,
                width: Math.max(1, (x2 - x1) * fx) * view.scale,
                height: Math.max(1, (y2 - y1) * fy) * view.scale,
                accent,
              });
            }
          }
        }
        return (
          <BboxOverlayLayer
            viewportWidth={viewport.w}
            viewportHeight={viewport.h}
            rects={rects}
          />
        );
      })()}

      {(() => {
        // Viewport-space chrome for the currently-selected and currently-hovered
        // masks. Rendered outside InfiniteCanvas so border weight, corner handles
        // and the hover pill stay pixel-crisp at any zoom.
        const activeId = activeMedia?.id ?? null;
        const soloLower = soloTag ? soloTag.toLowerCase() : null;
        const resolve = (id: MaskIdentity) => {
          // Hide chrome when the mask's tag is filtered out on the active
          // image. Leaves the underlying state intact — clearing solo will
          // make the chrome reappear.
          if (
            soloLower &&
            id.imageId === activeId &&
            id.tag.toLowerCase() !== soloLower
          ) {
            return null;
          }
          const m = paintMedia.find((x) => x.id === id.imageId);
          if (!m || m.kind !== 'image') return null;
          const state = segments[id.imageId];
          if (!state) return null;
          // Match by entryId when present (two box entries can share a tag;
          // the unique boxId pins down the right entry). Fall back to a
          // tag-only match for text entries where boxId is absent.
          const entry = state.entries.find((e) => {
            if (e.status !== 'ready') return false;
            if (id.entryId !== undefined) {
              return e.kind === 'box' && e.boxId === id.entryId;
            }
            return e.tag.toLowerCase() === id.tag.toLowerCase();
          });
          if (!entry || entry.status !== 'ready') return null;
          const mask = entry.response.masks[id.maskIndex];
          if (!mask || !mask.bbox) return null;
          const [x1, y1, x2, y2] = mask.bbox;
          const fx = m.width / mask.width;
          const fy = m.height / mask.height;
          const wx = m.x + x1 * fx;
          const wy = m.y + y1 * fy;
          const ww = Math.max(1, (x2 - x1) * fx);
          const wh = Math.max(1, (y2 - y1) * fy);
          const { accent } = colorForTag(entry.tag);
          return {
            tag: entry.tag,
            score: mask.score,
            accent,
            left: wx * view.scale + view.x,
            top: wy * view.scale + view.y,
            width: ww * view.scale,
            height: wh * view.scale,
          };
        };

        const selected = selectedMask ? resolve(selectedMask) : null;
        const hoverId =
          hoveredMask &&
          (!selectedMask ||
            hoveredMask.imageId !== selectedMask.imageId ||
            hoveredMask.tag !== selectedMask.tag ||
            hoveredMask.maskIndex !== selectedMask.maskIndex ||
            hoveredMask.entryId !== selectedMask.entryId)
            ? hoveredMask
            : null;
        const hover = hoverId ? resolve(hoverId) : null;

        return (
          <>
            {selected && (
              <>
                <div
                  key={`selected-${selectedMask!.imageId}-${selectedMask!.tag}-${selectedMask!.maskIndex}`}
                  className="segment-mask-selected"
                  style={
                    {
                      left: selected.left,
                      top: selected.top,
                      width: selected.width,
                      height: selected.height,
                      '--seg-accent': selected.accent,
                    } as React.CSSProperties
                  }
                >
                  {(['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map(
                    (corner) => (
                      <span
                        key={corner}
                        className={`segment-mask-handle interactive ${corner}`}
                        role="button"
                        aria-label={`Resize ${corner}`}
                        onPointerDown={(e) =>
                          handleBboxResizePointerDown(e, selectedMask!, corner)
                        }
                        onPointerMove={handleBboxResizePointerMove}
                        onPointerUp={handleBboxResizePointerUp}
                        onPointerCancel={handleBboxResizePointerUp}
                      />
                    ),
                  )}
                </div>
                {activeResize && (() => {
                  // Precision guides through the edge(s) being dragged. Corner
                  // handles move two edges and therefore light both axes; edge
                  // handles move one edge and only light that axis.
                  const vGuide: number | null =
                    activeResize === 'tl' ||
                    activeResize === 'bl' ||
                    activeResize === 'l'
                      ? selected.left
                      : activeResize === 'tr' ||
                          activeResize === 'br' ||
                          activeResize === 'r'
                        ? selected.left + selected.width
                        : null;
                  const hGuide: number | null =
                    activeResize === 'tl' ||
                    activeResize === 'tr' ||
                    activeResize === 't'
                      ? selected.top
                      : activeResize === 'bl' ||
                          activeResize === 'br' ||
                          activeResize === 'b'
                        ? selected.top + selected.height
                        : null;
                  return (
                    <>
                      {vGuide !== null && (
                        <div
                          className="bbox-resize-guide v"
                          aria-hidden
                          style={{ left: vGuide }}
                        />
                      )}
                      {hGuide !== null && (
                        <div
                          className="bbox-resize-guide h"
                          aria-hidden
                          style={{ top: hGuide }}
                        />
                      )}
                    </>
                  );
                })()}
              </>
            )}
            {hover && (
              <div
                key={`hover-${hoverId!.imageId}-${hoverId!.tag}-${hoverId!.maskIndex}`}
                className="segment-mask-hover"
                aria-hidden
                style={
                  {
                    left: hover.left,
                    top: hover.top,
                    width: hover.width,
                    height: hover.height,
                    '--seg-accent': hover.accent,
                  } as React.CSSProperties
                }
              >
                <span className="segment-mask-handle tl" />
                <span className="segment-mask-handle tr" />
                <span className="segment-mask-handle bl" />
                <span className="segment-mask-handle br" />
                <span className="segment-mask-hover-pill">
                  <span className="segment-mask-hover-tag">{hover.tag}</span>
                  <span className="segment-mask-hover-score">
                    {hover.score.toFixed(2)}
                  </span>
                </span>
              </div>
            )}
          </>
        );
      })()}

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
          projectId={projectId}
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
          <button
            type="button"
            className="wordmark-home"
            aria-label="Back to Home"
            title="Back to Home"
            onClick={() => void focusHome()}
          >
            <i className="ri-home-2-line wordmark-home-icon" aria-hidden />
            <span className="wordmark-glyph">NetraRT</span>
          </button>
          {projectState.status === 'ready' && (
            <>
              <span className="wordmark-divider" aria-hidden />
              <ProjectChip project={projectState.project} />
            </>
          )}
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
        <SavedTagsPopover projectId={projectId} />
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
        project={projectState.status === 'ready' ? projectState.project : undefined}
        onRenameProject={
          projectState.status === 'ready'
            ? async (name) => {
                await updateProject(projectState.project.id, { name });
              }
            : undefined
        }
        onDeleteProject={() => {
          setSettingsOpen(false);
          setDeleteProjectOpen(true);
        }}
      />

      {deleteProjectOpen && projectState.status === 'ready' && (
        <DeleteProjectModal
          project={projectState.project}
          onClose={() => {
            setDeleteProjectOpen(false);
            // Cancel returns the user to where they came from — settings.
            setSettingsOpen(true);
          }}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}

      <ImportPreviewModal
        state={preview.state}
        onCancel={preview.cancel}
        onImport={onConfirmImport}
        onChangeFormat={preview.setChosenFormat}
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
