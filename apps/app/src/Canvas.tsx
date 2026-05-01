import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasShell,
  useCanvasShell,
  useCanvasTitle,
  useFitBounds,
  useViewport,
  type InfiniteCanvasHandle,
  type View,
  readStoredView,
} from './features/canvas-core';
import {
  ActiveTagListLayer,
  BakeForImage,
  BboxOverlayContainer,
  BoxCrosshair,
  ContextMenuLayer,
  DrawBoxPreview,
  EmptyState,
  EncodingOverlays,
  MarqueeRect,
  MediaItem,
  MediaSearchPalette,
  MediaToolbar,
  PendingBoxLabelLayer,
  PendingOverlays,
  Sam3VersionBadge,
  SavedTagsPopover,
  SegmentChipsLayer,
  SelectionBboxLayer,
  SelectionHud,
  TagInputLayer,
  UserBoxesLayer,
  VisionCanvasModals,
  useBboxResizeGesture,
  useCanvasHydration,
  useCanvasKeyboardShortcuts,
  useDrawBoxGesture,
  useDropHandler,
  useHoverState,
  useLodSetup,
  useMarqueeGesture,
  useMediaDragGesture,
  useMediaHandlers,
  useSavedTags,
  useSegmentationState,
  useSelectionActions,
  useSelectionDerived,
  useStackOrder,
  useToolMode,
  useTrashSweep,
  useUploadPipeline,
  useVisibleMedia,
  type CanvasMedia,
  type ConnState,
  type DragState,
  type PendingBoxLabel,
  type SearchItem,
  type UserBox,
} from './features/vision-canvas';
import { FloatingSidebar } from './components/FloatingSidebar';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { useImportPreview } from './hooks/useImportPreview';
import { useHistory, useHistoryShortcuts } from './lib/history';
import { type CanvasActionMeta } from './lib/canvasHistory';
import { DeletedBanner, useProject } from './features/projects';
import { HIGHLIGHT_BOTTOM_INSET_PX, VISION_VIEW_STORAGE_KEY } from './features/vision-canvas/lib';
import './App.css';

type CanvasProps = {
  projectId: string;
  /** When set, SAM3 failed to load; encode/segment calls are skipped. */
  sam3Error?: string | null;
};

export function Canvas({ projectId, sam3Error = null }: CanvasProps) {
  const projectState = useProject(projectId);
  const project = projectState.status === 'ready' ? projectState.project : null;
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasTitle(projectId, projectState);

  const history = useHistory<CanvasActionMeta>({
    limit: 100,
    onError: (err, phase) => console.warn(`[history] ${phase} failed`, err),
  });
  useHistoryShortcuts(history);

  const [conn, setConn] = useState<ConnState>('connecting');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  // Lifted so the import-preview modal lives in the page-level Modals slot
  // while the body owns the drop handler that drives it.
  const preview = useImportPreview();
  // The body owns `onConfirmImport` (it closes over body-only state). Bridge
  // it to the page-level modal via a ref the body keeps updated.
  const confirmImportRef = useRef<() => void>(() => {});
  const handleConfirmImport = useCallback(() => {
    confirmImportRef.current();
  }, []);

  if (projectState.status === 'deleted') return <DeletedBanner />;

  return (
    <CanvasShell
      projectId={projectId}
      viewKey={VISION_VIEW_STORAGE_KEY}
      project={project}
      panSpeed={settings.panSpeed}
      zoomSensitivity={settings.zoomSensitivity}
      searchAriaLabel="Search media (⌘K / Ctrl+K)"
      searchTitle="Search media (⌘K)"
      fitFocusOpts={{ bottomInset: HIGHLIGHT_BOTTOM_INSET_PX }}
      topHudExtra={<TopHudExtra conn={conn} sam3Error={sam3Error} />}
      appControlsLeading={<SavedTagsPopover projectId={projectId} />}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      <CanvasBody
        projectId={projectId}
        sam3Error={sam3Error}
        history={history}
        conn={conn}
        setConn={setConn}
        preview={preview}
        confirmImportRef={confirmImportRef}
      />

      <CanvasShell.Modals>
        <VisionCanvasModals
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          settings={settings}
          updateSetting={updateSetting}
          resetSettings={resetSettings}
          project={project ?? undefined}
          deleteProjectOpen={deleteProjectOpen}
          setDeleteProjectOpen={setDeleteProjectOpen}
          preview={preview}
          onConfirmImport={handleConfirmImport}
        />
      </CanvasShell.Modals>
    </CanvasShell>
  );
}

type TopHudExtraProps = {
  conn: ConnState;
  sam3Error: string | null;
};

function TopHudExtra({ conn, sam3Error }: TopHudExtraProps) {
  return (
    <>
      <span className="wordmark-divider" aria-hidden />
      <span
        className={`conn-dot conn-${conn}`}
        aria-label={`connection ${conn}`}
      />
      <span className="wordmark-tag">{conn}</span>
      <span className="wordmark-divider" aria-hidden />
      {sam3Error ? (
        <span
          className="wordmark-tag sam3-error-tag"
          role="alert"
          title={sam3Error}
        >
          SAM3 Error
        </span>
      ) : (
        <Sam3VersionBadge />
      )}
    </>
  );
}

type BodyProps = {
  projectId: string;
  sam3Error: string | null;
  history: ReturnType<typeof useHistory<CanvasActionMeta>>;
  conn: ConnState;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  preview: ReturnType<typeof useImportPreview>;
  confirmImportRef: React.MutableRefObject<() => void>;
};

function CanvasBody({
  projectId,
  sam3Error,
  history,
  conn,
  setConn,
  preview,
  confirmImportRef,
}: BodyProps) {
  const sam3Available = !sam3Error;
  const shell = useCanvasShell();
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;
  const {
    view,
    cursor,
    searchOpen,
    setSearchOpen,
    setDropHandler,
    setBackgroundPointerDown,
    setFitBoundsGetter,
  } = shell;

  // ─── Plain state ────────────────────────────────────────────────────────
  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string[]>>({});
  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);
  const [userBoxes, setUserBoxes] = useState<Record<string, UserBox[]>>({});
  const [pendingBoxLabel, setPendingBoxLabel] = useState<PendingBoxLabel | null>(null);
  const [contextMenu, setContextMenu] = useState<
    { id: string; x: number; y: number } | null
  >(null);

  // ─── Refs (live mirrors + gesture state) ────────────────────────────────
  const initialHadStoredView = useRef<boolean>(
    readStoredView(VISION_VIEW_STORAGE_KEY) !== null,
  );
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
  const { remember: rememberSavedTag } = useSavedTags(projectId);
  const viewport = useViewport();
  const { hoverId, setHoverId, clearHideTimer, scheduleHide } = useHoverState();
  const { tool, setTool, toolRef } = useToolMode();
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
  const { handleDrop, onConfirmImport } = useDropHandler({
    projectId,
    canvasRef,
    mediaRef,
    runUploadPlan,
    setSegments,
    preview,
  });

  // Register the drop handler with the shell so InfiniteCanvas receives it.
  useEffect(() => {
    setDropHandler(handleDrop);
    return () => setDropHandler(null);
  }, [setDropHandler, handleDrop]);

  // Register the marquee background-pointer handler with the shell.
  useEffect(() => {
    setBackgroundPointerDown(handleBackgroundPointerDown);
    return () => setBackgroundPointerDown(null);
  }, [setBackgroundPointerDown, handleBackgroundPointerDown]);

  // Register fit-bounds for the bottom HUD's Reset button.
  const getFitBounds = useFitBounds<CanvasMedia>(media, (m) => ({
    w: m.width,
    h: m.height,
  }));
  useEffect(() => {
    setFitBoundsGetter(getFitBounds);
    return () => setFitBoundsGetter(null);
  }, [setFitBoundsGetter, getFitBounds]);

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

  const handleSearchSelect = useCallback(
    (item: SearchItem) => {
      setSearchOpen(false);
      canvasRef.current?.focusOn(
        { x: item.x, y: item.y, width: item.width, height: item.height },
        { animate: true, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [canvasRef, setSearchOpen],
  );

  // ─── Derived values used by JSX ────────────────────────────────────────
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

  // Publish the body-owned `onConfirmImport` to the page-level Modals slot.
  confirmImportRef.current = onConfirmImport;

  return (
    <>
      <CanvasShell.Canvas>
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
      </CanvasShell.Canvas>

      <CanvasShell.Overlays>
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
        <ContextMenuLayer
          contextMenu={contextMenu}
          media={media}
          selectedIds={selectedIds}
          onDeleteSelection={deleteSelection}
          onDeleteMedia={deleteMediaById}
          onClose={() => setContextMenu(null)}
        />
      </CanvasShell.Overlays>

      <CanvasShell.Sidebar>
        <FloatingSidebar
          items={media}
          activeId={activeId}
          onSelect={handleSidebarSelect}
        />
      </CanvasShell.Sidebar>

      <CanvasShell.SearchPalette>
        <MediaSearchPalette
          open={searchOpen}
          items={searchItems}
          onSelect={handleSearchSelect}
          onClose={() => setSearchOpen(false)}
        />
      </CanvasShell.SearchPalette>
    </>
  );
}

