import { useCanvasPage, useCanvasShell, useViewport } from '../../../canvas-core';
import { ActiveTagListLayer } from './ActiveTagListLayer';
import { BboxOverlayContainer } from './BboxOverlayContainer';
import { BoxCrosshair } from './BoxCrosshair';
import { ContextMenuLayer } from './ContextMenuLayer';
import { DrawBoxPreview } from './DrawBoxPreview';
import { EmptyState } from './EmptyState';
import { EncodingOverlays } from './EncodingOverlays';
import { MarqueeRect } from './MarqueeRect';
import { MediaToolbar } from '../MediaToolbar';
import { PendingBoxLabelLayer } from './PendingBoxLabelLayer';
import { PendingOverlays } from './PendingOverlays';
import { SegmentChipsLayer } from './SegmentChipsLayer';
import { SelectionBboxLayer } from './SelectionBboxLayer';
import { SelectionHud } from './SelectionHud';
import { TagInputLayer } from './TagInputLayer';
import { UserBoxesLayer } from './UserBoxesLayer';
import { useVisionConn } from '../../context/slices/useVisionConn';
import { useVisionMedia } from '../../context/slices/useVisionMedia';
import { useVisionSelection } from '../../context/slices/useVisionSelection';
import { useVisionSegmentation } from '../../context/slices/useVisionSegmentation';
import { useVisionTools } from '../../context/slices/useVisionTools';

export function VisionOverlays() {
  const { projectId } = useCanvasPage();
  const { view, cursor } = useCanvasShell();
  const viewport = useViewport();
  const { conn } = useVisionConn();
  const { media, paintMedia, visibleMedia, uploadStatus, encodingIds } =
    useVisionMedia();
  const {
    activeMedia,
    selectedIds,
    selectionBBox,
    multiSelectKey,
    setSelectedIds,
    setLastSelectedId,
    clearSelection,
    deleteSelection,
    deleteMediaById,
  } = useVisionSelection();
  const {
    segments,
    selectedMask,
    hoveredMask,
    soloTag,
    setSoloTag,
    pendingBoxLabel,
    userBoxes,
    confirmPendingBoxLabel,
    cancelPendingBoxLabel,
    deleteAllMasksForTag,
    submitSegment,
  } = useVisionSegmentation();
  const {
    tool,
    setTool,
    drawBoxPreview,
    marqueeRect,
    activeResize,
    handleBboxResizePointerDown,
    handleBboxResizePointerMove,
    handleBboxResizePointerUp,
    contextMenu,
    setContextMenu,
    clearHideTimer,
    scheduleHide,
    multiHighlightInput,
    setMultiHighlightInput,
    highlightInputs,
    setHighlightInputs,
  } = useVisionTools();

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
    </>
  );
}
