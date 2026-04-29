import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type BackgroundPointerDown,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from './InfiniteCanvas';
import {
  hardDeleteImage,
  hardDeleteVideo,
  listTrashed,
  type ImageRecord,
  type VideoRecord,
} from './lib/pb';
import { colorForTag, useSavedTags } from './components/savedTags';
import { MediaItem } from './features/canvas/components/MediaItem';
import { BakeForImage } from './features/canvas/components/BakeForImage';
import { useHoverState } from './features/canvas/hooks/useHoverState';
import { useUploadPipeline } from './features/canvas/hooks/useUploadPipeline';
import { useToolMode } from './features/canvas/hooks/useToolMode';
import { useCanvasHydration } from './features/canvas/hooks/useCanvasHydration';
import { useBboxResizeGesture } from './features/canvas/hooks/useBboxResizeGesture';
import { useSegmentationState } from './features/canvas/hooks/useSegmentationState';
import { useMarqueeGesture } from './features/canvas/hooks/useMarqueeGesture';
import { useDrawBoxGesture } from './features/canvas/hooks/useDrawBoxGesture';
import { useMediaDragGesture } from './features/canvas/hooks/useMediaDragGesture';
import { useSelectionActions } from './features/canvas/hooks/useSelectionActions';
import { useCanvasKeyboardShortcuts } from './features/canvas/hooks/useCanvasKeyboardShortcuts';
import { useLodSetup } from './features/canvas/hooks/useLodSetup';
import {
  PendingOverlays,
  EncodingOverlays,
  MarqueeRect,
  UserBoxesLayer,
  DrawBoxPreview,
  PendingBoxLabelLayer,
  SegmentChipsLayer,
  CanvasModals,
  ContextMenuLayer,
  BboxOverlayContainer,
  SelectionHud,
  SelectionBboxLayer,
  EmptyState,
  CanvasTopHud,
  CanvasBottomHud,
  CanvasAppControlsHud,
  TagInputLayer,
} from './features/canvas/components/layers';
import { FloatingSidebar } from './components/FloatingSidebar';
import type { SearchItem } from './components/MediaSearchPalette';
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
import {
  type MaskIdentity,
  type ReadyMaskEntry,
} from './features/segmentation';
import { useHistory, useHistoryShortcuts } from './lib/history';
import {
  createEntry,
  type CanvasActionMeta,
} from './lib/canvasHistory';
import {
  buildDescriptorFromFile,
  captureDataTransfer,
  dropContainsFolderOrZip,
  scanTauriPaths,
  type MediaDescriptor,
} from './lib/mediaIngest';
import { subscribeTauriDrops } from './lib/tauriDragDrop';
import type { AnnotationFormat, AnnotationPlan } from './lib/annotations';
import { useImportPreview } from './hooks/useImportPreview';
import {
  DeletedBanner,
  useProject,
  useProjectThumbnail,
} from './features/projects';
import { setCanvasTitle } from './lib/windows';
import {
  VIEW_PERSIST_DEBOUNCE_MS,
  getInitialView,
  readStoredView,
  writeStoredView,
} from './lib/canvasView';
import {
  CULL_BUFFER_FACTOR,
  DRAG_THRESHOLD_PX,
  DRAW_BOX_MIN_SIZE_PX,
  HIGHLIGHT_BOTTOM_INSET_PX,
  STACK_ORDER_PERSIST_DEBOUNCE_MS,
  describeDrop,
  deleteImageEncoding,
  applyAnnotationPlanToCanvas,
  genBoxId,
  makeImageIdCollector,
  medianLongestSide,
  prepareImportPlan,
  readStoredStackOrder,
  uid,
  writeStoredStackOrder,
  type CanvasMedia,
  type ConnState,
  type MediaPointerEvent,
  type PendingBoxLabel,
  type SegMask,
  type SegmentState,
  type TagSegment,
  type UploadPlan,
  type UserBox,
} from './features/canvas/lib';
import './App.css';

type CanvasProps = {
  projectId: string;
  /** When set, SAM3 failed to load; encode/segment calls are skipped. */
  sam3Error?: string | null;
};

export function Canvas({ projectId, sam3Error = null }: CanvasProps) {
  const sam3Available = !sam3Error;

  const projectState = useProject(projectId);

  useEffect(() => {
    if (projectState.status !== 'ready') return;
    void setCanvasTitle(projectId, projectState.project.name);
  }, [projectId, projectState]);

  const { remember: rememberSavedTag } = useSavedTags(projectId);
  const searchPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const statusPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const controlsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const settingsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });

  const canvasRef = useRef<InfiniteCanvasHandle>(null);

  const getLodCanvas = useCallback((): HTMLCanvasElement | null => {
    const el = document.querySelector('canvas.lod-layer');
    return el instanceof HTMLCanvasElement ? el : null;
  }, []);
  useProjectThumbnail(projectId, getLodCanvas);

  const initialHadStoredView = useRef<boolean>(readStoredView() !== null);
  // Guards the media→stackOrder sync from wiping the hydrated order before PB resolves.
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  // Paint order (bottom → top); separate from `media` so raise-to-top doesn't reshuffle sidebar.
  const [stackOrder, setStackOrder] = useState<string[]>(readStoredStackOrder);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);

  const { hoverId, setHoverId, clearHideTimer, scheduleHide } = useHoverState();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string[]>>({});
  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);

  const [userBoxes, setUserBoxes] = useState<Record<string, UserBox[]>>({});

  const [pendingBoxLabel, setPendingBoxLabel] = useState<PendingBoxLabel | null>(null);

  const mediaRef = useRef<CanvasMedia[]>(media);
  mediaRef.current = media;

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const { tool, setTool, toolRef } = useToolMode();

  const history = useHistory<CanvasActionMeta>({
    limit: 100,
    onError: (err, phase) => {
      console.warn(`[history] ${phase} failed`, err);
    },
  });
  useHistoryShortcuts(history);

  const viewRef = useRef<View>(view);
  viewRef.current = view;

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const clearSelectionRef = useRef<() => void>(() => {});

  const { marqueeRect, marqueeRef, handleBackgroundPointerDown } =
    useMarqueeGesture({
      viewRef,
      mediaRef,
      selectedIdsRef,
      setSelectedIds,
      setLastSelectedId,
      clearSelectionRef,
    });

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
  const { lodCache, lodSources, priorityIds, setPriorityIds, dropAsset } =
    useLodSetup({ paintMedia, media, viewScale: view.scale, dpr });

  const { uploadStatus, encodingIds, runUploadPlan, abortUpload } =
    useUploadPipeline({
      projectId,
      sam3Available,
      setMedia,
      setPriorityIds,
      setConn,
      history,
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

  const {
    segments,
    setSegments,
    segmentsRef,
    selectedMask,
    setSelectedMask,
    hoveredMask,
    soloTag,
    setSoloTag,
    handleMaskSelect,
    handleMaskHover,
    clearSegment,
    replaceReadyTag,
    deleteMask,
    deleteAllMasksForTag,
    removeSegmentTag,
    submitSegment,
    confirmPendingBoxLabel,
    cancelPendingBoxLabel,
  } = useSegmentationState({
    projectId,
    sam3Available,
    mediaRef,
    history,
    setConn,
    pendingBoxLabel,
    setPendingBoxLabel,
    setSelectedIds,
    setLastSelectedId,
    setUserBoxes,
    rememberSavedTag,
  });

  const { initialMediaLoadedRef } = useCanvasHydration({
    projectId,
    canvasRef,
    initialHadStoredView,
    setMedia,
    setSegments,
    setConn,
  });

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

  const { drawBoxPreview, drawBoxRef, beginDraw } = useDrawBoxGesture({
    viewRef,
    selectedIdsRef,
    setSelectedIds,
    setLastSelectedId,
    setPendingBoxLabel,
  });

  const {
    dragRef,
    shiftToggledRef,
    beginDrag,
    handlePointerMove: handleMediaPointerMove,
    handlePointerUp: handleMediaPointerUp,
  } = useMediaDragGesture({
    viewRef,
    mediaRef,
    selectedIdsRef,
    setMedia,
    setConn,
    history,
    bringToFront,
  });

  useEffect(() => {
    if (selectedIds.size === 0) return;
    bringToFront(selectedIds);
  }, [selectedIds, bringToFront]);

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
    setSelectedMask(null);
    setSoloTag(null);
  }, [setSelectedMask, setSoloTag]);
  clearSelectionRef.current = clearSelection;

  useEffect(() => {
    if (selectedIds.size > 0) setSelectedMask(null);
  }, [selectedIds]);


  const { selectAll, duplicateSelection, deleteMediaById, deleteSelection } =
    useSelectionActions({
      mediaRef,
      selectedIdsRef,
      setMedia,
      setSelectedIds,
      setLastSelectedId,
      setHoverId,
      setConn,
      history,
      runUploadPlan,
      abortUpload,
      clearSegment,
      lodCache,
      dropAsset,
    });

  useCanvasKeyboardShortcuts({
    canvasRef,
    mediaRef,
    selectedIdsRef,
    lastSelectedIdRef,
    segmentsRef,
    activeMedia,
    selectedMask,
    soloTag,
    setSelectedIds,
    setLastSelectedId,
    setHoverId,
    setSoloTag,
    setSearchOpen,
    setTool,
    clearHideTimer,
    clearSelection,
    selectAll,
    duplicateSelection,
    deleteSelection,
    deleteMask,
    deleteAllMasksForTag,
  });

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
      const prepared = await prepareImportPlan(
        descriptors,
        point,
        mediaRef.current,
      );
      if (!prepared) return;
      const { plan, descriptorByDraftId, focusRect } = prepared;

      const imageIdByDescriptorPath = new Map<string, string>();
      const onUploaded = makeImageIdCollector(
        descriptorByDraftId,
        imageIdByDescriptorPath,
      );

      const uploading = runUploadPlan(plan, onUploaded);
      canvasRef.current?.focusOn(focusRect, {
        bottomInset: HIGHLIGHT_BOTTOM_INSET_PX,
      });
      await uploading;

      if (!annotationPlan || chosenFormat === 'none') return;
      await applyAnnotationPlanToCanvas({
        projectId,
        plan: annotationPlan,
        chosenFormat,
        descriptors,
        imageIdByDescriptorPath,
        setSegments,
      });
    },
    [projectId, runUploadPlan],
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

  const handleMediaPointerDown = useCallback(
    (e: MediaPointerEvent, m: CanvasMedia) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (e.shiftKey || toolRef.current !== 'box') {
        beginDrag(e, m, setSelectedIds, setLastSelectedId);
        return;
      }
      beginDraw(e, m);
    },
    [beginDraw, beginDrag, toolRef],
  );

  // Bbox drag-resize on the selected mask. Live edits run through setSegments
  // for instant visual feedback; history is pushed once on pointerup so an
  // entire drag is a single undo step. Eight handles total: four corners for
  // diagonal resize and four edge midpoints for single-axis resize.
  const {
    activeResize,
    handlePointerDown: handleBboxResizePointerDown,
    handlePointerMove: handleBboxResizePointerMove,
    handlePointerUp: handleBboxResizePointerUp,
  } = useBboxResizeGesture({
    projectId,
    viewRef,
    mediaRef,
    segmentsRef,
    setSegments,
    setConn,
    history,
    replaceReadyTag,
  });

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

      <PendingOverlays
        visibleMedia={visibleMedia}
        view={view}
        uploadStatus={uploadStatus}
      />

      <EncodingOverlays
        visibleMedia={visibleMedia}
        view={view}
        encodingIds={encodingIds}
      />

      <SegmentChipsLayer
        visibleMedia={visibleMedia}
        view={view}
        segments={segments}
      />

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


      <MarqueeRect rect={marqueeRect} view={view} />

      <UserBoxesLayer
        paintMedia={paintMedia}
        view={view}
        userBoxes={userBoxes}
        segments={segments}
      />

      <DrawBoxPreview preview={drawBoxPreview} view={view} />

      <PendingBoxLabelLayer
        pending={pendingBoxLabel}
        view={view}
        projectId={projectId}
        onConfirm={confirmPendingBoxLabel}
        onCancel={cancelPendingBoxLabel}
      />

      <BboxOverlayContainer
        paintMedia={paintMedia}
        view={view}
        segments={segments}
        selectedMask={selectedMask}
        hoveredMask={hoveredMask}
        activeId={activeMedia?.id ?? null}
        soloTag={soloTag}
        viewport={viewport}
      />

      <SelectionHud
        paintMedia={paintMedia}
        view={view}
        segments={segments}
        selectedMask={selectedMask}
        hoveredMask={hoveredMask}
        activeId={activeMedia?.id ?? null}
        soloTag={soloTag}
        activeResize={activeResize}
        onResizePointerDown={handleBboxResizePointerDown}
        onResizePointerMove={handleBboxResizePointerMove}
        onResizePointerUp={handleBboxResizePointerUp}
      />

      <SelectionBboxLayer
        selectionBBox={selectionBBox}
        marqueeRect={marqueeRect}
        view={view}
        selectedCount={selectedIds.size}
      />

      <TagInputLayer
        projectId={projectId}
        activeMedia={activeMedia}
        activeRect={activeRect}
        highlightInputs={highlightInputs}
        setHighlightInputs={setHighlightInputs}
        selectionBBox={selectionBBox}
        marqueeRect={marqueeRect}
        view={view}
        multiSelectKey={multiSelectKey}
        multiHighlightInput={multiHighlightInput}
        setMultiHighlightInput={setMultiHighlightInput}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        setLastSelectedId={setLastSelectedId}
        clearSelection={clearSelection}
        clearHideTimer={clearHideTimer}
        scheduleHide={scheduleHide}
        deleteSelection={deleteSelection}
        onSubmitSegment={submitSegment}
      />

      <EmptyState isEmpty={isEmpty} />

      <FloatingSidebar
        items={media}
        activeId={activeId}
        onSelect={handleSidebarSelect}
      />

      <ContextMenuLayer
        contextMenu={contextMenu}
        media={media}
        selectedIds={selectedIds}
        onDeleteSelection={deleteSelection}
        onDeleteMedia={deleteMediaById}
        onClose={() => setContextMenu(null)}
      />

      <CanvasTopHud
        glass={wordmarkGlass}
        project={projectState.status === 'ready' ? projectState.project : null}
        conn={conn}
        sam3Error={sam3Error}
      />

      <CanvasBottomHud
        searchPillGlass={searchPillGlass}
        statusPillGlass={statusPillGlass}
        controlsPillGlass={controlsPillGlass}
        view={view}
        cursor={cursor}
        canvasRef={canvasRef}
        mediaRef={mediaRef}
        onSearchOpen={() => setSearchOpen(true)}
      />

      <CanvasAppControlsHud
        projectId={projectId}
        glass={settingsPillGlass}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <CanvasModals
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        settings={settings}
        updateSetting={updateSetting}
        resetSettings={resetSettings}
        project={projectState.status === 'ready' ? projectState.project : undefined}
        deleteProjectOpen={deleteProjectOpen}
        setDeleteProjectOpen={setDeleteProjectOpen}
        preview={preview}
        onConfirmImport={onConfirmImport}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        searchItems={searchItems}
        onSearchSelect={handleSearchSelect}
      />
    </>
  );
}
