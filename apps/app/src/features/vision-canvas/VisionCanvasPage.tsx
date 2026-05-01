import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasPage,
  CanvasShell,
  useCanvasPage,
  useCanvasShell,
  useFitBounds,
  useViewport,
  type InfiniteCanvasHandle,
  type View,
} from '../canvas-core';
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
  VisionCanvasProvider,
  useBboxResizeGesture,
  useCanvasKeyboardShortcuts,
  useDrawBoxGesture,
  useDropHandler,
  useHoverState,
  useMarqueeGesture,
  useMediaDragGesture,
  useMediaHandlers,
  useToolMode,
  useTrashSweep,
  useVisionMedia,
  useVisionSegmentation,
  useVisionSelection,
  type CanvasMedia,
  type ConnState,
  type DragState,
  type MarqueeState,
  type SearchItem,
} from './';
import type { MarqueeRect as MarqueeRectType } from './hooks/useMarqueeGesture';
import { FloatingSidebar } from '../../components/FloatingSidebar';
import { BootCard } from '../../components/BootCard';
import { useSettings } from '../../hooks/useSettings';
import { useImportPreview } from '../../hooks/useImportPreview';
import { focusHome } from '../../lib/windows';
import { HIGHLIGHT_BOTTOM_INSET_PX, VISION_VIEW_STORAGE_KEY } from './lib';
import { useSam3Boot } from './hooks/useSam3Boot';
import '../../App.css';

type VisionCanvasPageProps = {
  projectId: string;
};

export function VisionCanvasPage({ projectId }: VisionCanvasPageProps) {
  const { settings } = useSettings();
  const boot = useSam3Boot(settings.activeModel);

  if (boot.status === 'loading') {
    return (
      <BootCard
        spinner
        title="Loading SAM3 model…"
        subtitle="First launch loads the image encoder onto the GPU. This takes a few seconds."
      />
    );
  }
  if (boot.status === 'no-model') {
    return (
      <BootCard
        role="alert"
        title="No model active"
        subtitle="Install one from Home → Models."
        action={
          <button
            type="button"
            className="btn btn-md btn-primary"
            onClick={() => void focusHome()}
          >
            Open Home
          </button>
        }
      />
    );
  }
  const sam3Error = boot.status === 'error' ? boot.message : null;

  return <VisionCanvasPageInner projectId={projectId} sam3Error={sam3Error} />;
}

type InnerProps = { projectId: string; sam3Error: string | null };

function VisionCanvasPageInner({ projectId, sam3Error }: InnerProps) {
  const [conn, setConn] = useState<ConnState>('connecting');

  // State lifted here temporarily so the provider can consume it AND the
  // body still owns the gestures that read it. Subsequent tasks (C5) absorb
  // each piece into the provider in turn.
  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRectType>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoverState = useHoverState();
  const { hoverId, setHoverId } = hoverState;

  const preview = useImportPreview();
  const confirmImportRef = useRef<() => void>(() => {});
  const handleConfirmImport = useCallback(() => {
    confirmImportRef.current();
  }, []);

  return (
    <CanvasPage
      projectId={projectId}
      viewKey={VISION_VIEW_STORAGE_KEY}
      searchAriaLabel="Search media (⌘K / Ctrl+K)"
      searchTitle="Search media (⌘K)"
      fitFocusOpts={{ bottomInset: HIGHLIGHT_BOTTOM_INSET_PX }}
      topHudExtra={<TopHudExtra conn={conn} sam3Error={sam3Error} />}
      appControlsLeading={<SavedTagsPopover projectId={projectId} />}
      modals={(m) => (
        <VisionCanvasModals
          {...m}
          preview={preview}
          onConfirmImport={handleConfirmImport}
        />
      )}
    >
      <VisionCanvasProvider
        conn={conn}
        setConn={setConn}
        sam3Error={sam3Error}
        dragRef={dragRef}
        hoverId={hoverId}
        setHoverId={setHoverId}
        marqueeRect={marqueeRect}
        marqueeRef={marqueeRef}
        setMultiHighlightInput={setMultiHighlightInput}
      >
        <CanvasBody
          conn={conn}
          setConn={setConn}
          preview={preview}
          confirmImportRef={confirmImportRef}
          hoverState={hoverState}
          multiHighlightInput={multiHighlightInput}
          setMultiHighlightInput={setMultiHighlightInput}
          marqueeRect={marqueeRect}
          setMarqueeRect={setMarqueeRect}
          marqueeRef={marqueeRef}
          dragRef={dragRef}
        />
      </VisionCanvasProvider>
    </CanvasPage>
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
  conn: ConnState;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  preview: ReturnType<typeof useImportPreview>;
  confirmImportRef: React.MutableRefObject<() => void>;
  hoverState: ReturnType<typeof useHoverState>;
  multiHighlightInput: string[];
  setMultiHighlightInput: React.Dispatch<React.SetStateAction<string[]>>;
  marqueeRect: MarqueeRectType;
  setMarqueeRect: React.Dispatch<React.SetStateAction<MarqueeRectType>>;
  marqueeRef: React.MutableRefObject<MarqueeState | null>;
  dragRef: React.MutableRefObject<DragState | null>;
};

function CanvasBody({
  conn,
  setConn,
  preview,
  confirmImportRef,
  hoverState,
  multiHighlightInput,
  setMultiHighlightInput,
  marqueeRect,
  setMarqueeRect,
  marqueeRef,
  dragRef,
}: BodyProps) {
  const { projectId, history } = useCanvasPage();
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

  // ─── Media + upload + lod come from the provider ────────────────────────
  const {
    media,
    setMedia,
    mediaRef,
    paintMedia,
    visibleMedia,
    labelPlacements,
    uploadStatus,
    encodingIds,
    runUploadPlan,
    abortUpload,
    lodSources,
    setPriorityIds,
    bringToFront,
  } = useVisionMedia();
  void setPriorityIds; // owned by provider; unused here for now

  // ─── Selection comes from the provider ──────────────────────────────────
  const {
    selectedIds,
    setSelectedIds,
    selectedIdsRef,
    lastSelectedIdRef,
    setLastSelectedId,
    activeSet,
    activeId,
    activeMedia,
    selectionBBox,
    multiSelectKey,
    clearSelection,
    clearSelectionRef,
    selectAll,
    duplicateSelection,
    deleteMediaById,
    deleteSelection,
  } = useVisionSelection();

  // ─── Segmentation comes from the provider ───────────────────────────────
  const {
    segments,
    setSegments,
    segmentsRef,
    selectedMask,
    hoveredMask,
    soloTag,
    setSoloTag,
    pendingBoxLabel,
    setPendingBoxLabel,
    userBoxes,
    handleMaskSelect,
    handleMaskHover,
    replaceReadyTag,
    deleteMask,
    deleteAllMasksForTag,
    submitSegment,
    confirmPendingBoxLabel,
    cancelPendingBoxLabel,
  } = useVisionSegmentation();

  // ─── Plain state still owned by the body ────────────────────────────────
  const [highlightInputs, setHighlightInputs] = useState<Record<string, string[]>>({});
  const [contextMenu, setContextMenu] = useState<
    { id: string; x: number; y: number } | null
  >(null);

  // ─── Refs (live mirrors + gesture state) ────────────────────────────────
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  // ─── External one-line hooks ────────────────────────────────────────────
  const viewport = useViewport();
  const { setHoverId, clearHideTimer, scheduleHide } = hoverState;
  const { tool, setTool, toolRef } = useToolMode();
  useTrashSweep({ projectId, conn });

  // ─── Marquee gesture (must run before useVisibleMedia consumes marqueeRect)
  const { handleBackgroundPointerDown } = useMarqueeGesture({
    viewRef,
    mediaRef,
    selectedIdsRef,
    setSelectedIds,
    setLastSelectedId,
    clearSelectionRef,
    marqueeRef,
    setMarqueeRect,
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
