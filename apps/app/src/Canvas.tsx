import { useCallback, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import {
  ActiveTagListLayer,
  BakeForImage,
  BboxOverlayContainer,
  BoxCrosshair,
  CanvasAppControlsHud,
  CanvasBottomHud,
  CanvasModals,
  CanvasTopHud,
  ContextMenuLayer,
  DrawBoxPreview,
  EmptyState,
  EncodingOverlays,
  MarqueeRect,
  MediaItem,
  PendingBoxLabelLayer,
  PendingOverlays,
  SegmentChipsLayer,
  SelectionBboxLayer,
  SelectionHud,
  TagInputLayer,
  UserBoxesLayer,
  useBboxResizeGesture,
  useCanvasGlass,
  useCanvasHydration,
  useCanvasKeyboardShortcuts,
  useCanvasTitle,
  useDrawBoxGesture,
  useDropHandler,
  useHoverState,
  useLodSetup,
  useMarqueeGesture,
  useMediaDragGesture,
  useMediaHandlers,
  useSegmentationState,
  useSelectionActions,
  useSelectionDerived,
  useStackOrder,
  useToolMode,
  useTrashSweep,
  useUploadPipeline,
  useViewPersist,
  useViewport,
  useVisibleMedia,
  type CanvasMedia,
  type ConnState,
  type DragState,
  type PendingBoxLabel,
  type UserBox,
} from './features/canvas';
import { FloatingSidebar } from './components/FloatingSidebar';
import { MediaToolbar } from './components/MediaToolbar';
import { type SearchItem } from './components/MediaSearchPalette';
import { useSavedTags } from './components/savedTags';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { useHistory, useHistoryShortcuts } from './lib/history';
import { type CanvasActionMeta } from './lib/canvasHistory';
import { DeletedBanner, useProject, useProjectThumbnail } from './features/projects';
import { getInitialView, readStoredView } from './lib/canvasView';
import { HIGHLIGHT_BOTTOM_INSET_PX } from './features/canvas/lib';
import './App.css';

type CanvasProps = {
  projectId: string;
  /** When set, SAM3 failed to load; encode/segment calls are skipped. */
  sam3Error?: string | null;
};

export function Canvas({ projectId, sam3Error = null }: CanvasProps) {
  const sam3Available = !sam3Error;

  // ─── Plain state ────────────────────────────────────────────────────────
  const [view, setView] = useState<View>(getInitialView);
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string[]>>({});
  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);
  const [userBoxes, setUserBoxes] = useState<Record<string, UserBox[]>>({});
  const [pendingBoxLabel, setPendingBoxLabel] = useState<PendingBoxLabel | null>(null);
  const [contextMenu, setContextMenu] = useState<
    { id: string; x: number; y: number } | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ─── Refs (live mirrors + gesture state) ────────────────────────────────
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const initialHadStoredView = useRef<boolean>(readStoredView() !== null);
  // Guards the media→stackOrder sync from wiping the hydrated order before PB resolves.
  const initialMediaLoadedRef = useRef<boolean>(false);
  const dragRef = useRef<DragState | null>(null);
  const viewRef = useRef<View>(view);
  const mediaRef = useRef<CanvasMedia[]>(media);
  const selectedIdsRef = useRef(selectedIds);
  const lastSelectedIdRef = useRef(lastSelectedId);
  const clearSelectionRef = useRef<() => void>(() => {});
  viewRef.current = view;
  mediaRef.current = media;
  selectedIdsRef.current = selectedIds;
  lastSelectedIdRef.current = lastSelectedId;

  // ─── External one-line hooks ────────────────────────────────────────────
  const projectState = useProject(projectId);
  const { remember: rememberSavedTag } = useSavedTags(projectId);
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasTitle(projectId, projectState);
  const glass = useCanvasGlass();
  const viewport = useViewport();
  const { hoverId, setHoverId, clearHideTimer, scheduleHide } = useHoverState();
  const { tool, setTool, toolRef } = useToolMode();
  const history = useHistory<CanvasActionMeta>({
    limit: 100,
    onError: (err, phase) => console.warn(`[history] ${phase} failed`, err),
  });
  useHistoryShortcuts(history);
  useViewPersist(view);
  useTrashSweep({ projectId, conn });

  // ─── Marquee gesture (must run before useVisibleMedia consumes marqueeRect)
  const { marqueeRect, marqueeRef, handleBackgroundPointerDown } = useMarqueeGesture({
    viewRef,
    mediaRef,
    selectedIdsRef,
    setSelectedIds,
    setLastSelectedId,
    clearSelectionRef,
  });

  // ─── Stack order, visible/paint media, LOD ──────────────────────────────
  const { stackOrder, setStackOrder, bringToFront } = useStackOrder({
    media,
    selectedIds,
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
  const { lodCache, lodSources, setPriorityIds, dropAsset } = useLodSetup({
    paintMedia,
    media,
    viewScale: view.scale,
    dpr,
  });

  // ─── Upload + segmentation state ────────────────────────────────────────
  const { uploadStatus, encodingIds, runUploadPlan, abortUpload } = useUploadPipeline({
    projectId,
    sam3Available,
    setMedia,
    setPriorityIds,
    setConn,
    history,
  });
  const segmentation = useSegmentationState({
    projectId,
    sam3Available,
    mediaRef,
    history,
    setConn,
    pendingBoxLabel,
    setPendingBoxLabel,
    selectedIds,
    setSelectedIds,
    setLastSelectedId,
    setUserBoxes,
    rememberSavedTag,
  });
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
    submitSegment,
    confirmPendingBoxLabel,
    cancelPendingBoxLabel,
  } = segmentation;
  void setStackOrder; // currently only mutated inside useStackOrder

  // ─── Selection-derived view state + hydration ──────────────────────────
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

  // ─── Pointer gestures ───────────────────────────────────────────────────
  const { drawBoxPreview, beginDraw } = useDrawBoxGesture({
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

  // ─── Selection actions + clear (must precede keyboard shortcuts) ───────
  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
    setSelectedMask(null);
    setSoloTag(null);
  }, [setSelectedMask, setSoloTag]);
  clearSelectionRef.current = clearSelection;

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

  // ─── Canvas-event handlers ──────────────────────────────────────────────
  const { preview, handleDrop, onConfirmImport } = useDropHandler({
    projectId,
    canvasRef,
    mediaRef,
    runUploadPlan,
    setSegments,
  });
  const {
    handleMediaEnter,
    handleMediaLeave,
    handleMediaClick,
    handleMediaDoubleClick,
    handleMediaContextMenu,
    handleSidebarSelect,
    handleMediaPointerDown,
  } = useMediaHandlers({
    canvasRef,
    mediaRef,
    dragRef,
    shiftToggledRef,
    toolRef,
    setSelectedIds,
    setLastSelectedId,
    setHoverId,
    setContextMenu,
    clearHideTimer,
    scheduleHide,
    beginDrag,
    beginDraw,
  });
  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback(
    (p: WorldPoint | null) => setCursor(p),
    [],
  );
  const handleSearchSelect = useCallback((item: SearchItem) => {
    setSearchOpen(false);
    canvasRef.current?.focusOn(
      { x: item.x, y: item.y, width: item.width, height: item.height },
      { animate: true, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
    );
  }, []);

  // ─── Derived values used by JSX ────────────────────────────────────────
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
      <BoxCrosshair
        tool={tool}
        activeMedia={activeMedia}
        activeRect={activeRect}
        cursor={cursor}
        view={view}
      />
      {activeMedia && activeRect && (
        <MediaToolbar
          rect={activeRect}
          tool={tool}
          onToolChange={setTool}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
        />
      )}
      <ActiveTagListLayer
        activeMedia={activeMedia}
        activeRect={activeRect}
        segments={segments}
        soloTag={soloTag}
        setSoloTag={setSoloTag}
        onRemoveTag={deleteAllMasksForTag}
        onMouseEnter={clearHideTimer}
        onMouseLeave={scheduleHide}
      />
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
        glass={glass.wordmarkGlass}
        project={projectState.status === 'ready' ? projectState.project : null}
        conn={conn}
        sam3Error={sam3Error}
      />
      <CanvasBottomHud
        searchPillGlass={glass.searchPillGlass}
        statusPillGlass={glass.statusPillGlass}
        controlsPillGlass={glass.controlsPillGlass}
        view={view}
        cursor={cursor}
        canvasRef={canvasRef}
        mediaRef={mediaRef}
        onSearchOpen={() => setSearchOpen(true)}
      />
      <CanvasAppControlsHud
        projectId={projectId}
        glass={glass.settingsPillGlass}
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
