import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type BackgroundPointerDown,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from './InfiniteCanvas';
import type { ImageRecord, VideoRecord } from './lib/pb';
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
import { useDropHandler } from './features/canvas/hooks/useDropHandler';
import { useSelectionDerived } from './features/canvas/hooks/useSelectionDerived';
import { useVisibleMedia } from './features/canvas/hooks/useVisibleMedia';
import { useTrashSweep } from './features/canvas/hooks/useTrashSweep';
import { useStackOrder } from './features/canvas/hooks/useStackOrder';
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
  type MaskIdentity,
  type ReadyMaskEntry,
} from './features/segmentation';
import { useHistory, useHistoryShortcuts } from './lib/history';
import {
  createEntry,
  type CanvasActionMeta,
} from './lib/canvasHistory';
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
  DRAG_THRESHOLD_PX,
  DRAW_BOX_MIN_SIZE_PX,
  HIGHLIGHT_BOTTOM_INSET_PX,
  genBoxId,
  medianLongestSide,
  uid,
  type CanvasMedia,
  type ConnState,
  type DragState,
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
  const initialMediaLoadedRef = useRef<boolean>(false);
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  // Paint order (bottom → top); separate from `media` so raise-to-top doesn't reshuffle sidebar.
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

  const dragRef = useRef<DragState | null>(null);
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

  const { stackOrder, setStackOrder, bringToFront } = useStackOrder({
    media,
    initialMediaLoadedRef,
  });

  const { visibleMedia, paintMedia, labelPlacements } = useVisibleMedia({
    media,
    stackOrder,
    view,
    viewport,
    selectedIds,
    hoverId,
    getDraggingIds: () => dragRef.current?.orig.keys() ?? null,
  });

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



  useEffect(() => {
    const t = window.setTimeout(() => writeStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

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

  const { activeSet, activeId, activeMedia, selectionBBox, multiSelectKey } =
    useSelectionDerived({
      media,
      selectedIds,
      lastSelectedId,
      hoverId,
      marqueeRect,
      marqueeRef,
      setSoloTag,
      setMultiHighlightInput,
    });

  useCanvasHydration({
    projectId,
    canvasRef,
    initialHadStoredView,
    initialMediaLoadedRef,
    setMedia,
    setSegments,
    setConn,
  });

  // Launch-time sweep: hard-delete PB records soft-deleted more than 1 hour
  useTrashSweep({ projectId, conn });

  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;


  const { drawBoxPreview, drawBoxRef, beginDraw } = useDrawBoxGesture({
    viewRef,
    selectedIdsRef,
    setSelectedIds,
    setLastSelectedId,
    setPendingBoxLabel,
  });

  const {
    shiftToggledRef,
    beginDrag,
    handlePointerMove: handleMediaPointerMove,
    handlePointerUp: handleMediaPointerUp,
  } = useMediaDragGesture({
    viewRef,
    mediaRef,
    selectedIdsRef,
    dragRef,
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

  const { preview, handleDrop, onConfirmImport } = useDropHandler({
    projectId,
    canvasRef,
    mediaRef,
    runUploadPlan,
    setSegments,
  });

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
