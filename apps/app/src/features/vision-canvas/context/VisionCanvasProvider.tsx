import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  readStoredView,
  useCanvasPage,
  useCanvasShell,
  useFitBounds,
  useViewport,
  type InfiniteCanvasHandle,
  type View,
} from '../../canvas-core';
import type { MaskIdentity } from '../../segmentation';
import { useImportPreview } from '../../../hooks/useImportPreview';
import { useStackOrder } from '../hooks/useStackOrder';
import { useVisibleMedia } from '../hooks/useVisibleMedia';
import { useLodSetup } from '../hooks/useLodSetup';
import { useUploadPipeline } from '../hooks/useUploadPipeline';
import { useCanvasHydration } from '../hooks/useCanvasHydration';
import { useSelectionDerived } from '../hooks/useSelectionDerived';
import { useSelectionActions } from '../hooks/useSelectionActions';
import { useSegmentationState } from '../hooks/useSegmentationState';
import { useToolMode } from '../hooks/useToolMode';
import { useHoverState } from '../hooks/useHoverState';
import { useMarqueeGesture } from '../hooks/useMarqueeGesture';
import { useDrawBoxGesture } from '../hooks/useDrawBoxGesture';
import { useBboxResizeGesture } from '../hooks/useBboxResizeGesture';
import { useMediaDragGesture } from '../hooks/useMediaDragGesture';
import { useDropHandler } from '../hooks/useDropHandler';
import { useMediaHandlers } from '../hooks/useMediaHandlers';
import { useCanvasKeyboardShortcuts } from '../hooks/useCanvasKeyboardShortcuts';
import { useTrashSweep } from '../hooks/useTrashSweep';
import { useSavedTags } from '../components/savedTags';
import {
  VISION_VIEW_STORAGE_KEY,
  type CanvasMedia,
  type ConnState,
  type DragState,
  type PendingBoxLabel,
  type SegmentState,
  type UserBox,
} from '../lib';
import {
  VisionCanvasContextProvider,
  type VisionCanvasValue,
} from './VisionCanvasContext';

type Props = {
  conn: ConnState;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  sam3Error: string | null;
  children: ReactNode;
};

export function VisionCanvasProvider({
  conn,
  setConn,
  sam3Error,
  children,
}: Props) {
  const sam3Available = !sam3Error;
  const { projectId, history } = useCanvasPage();
  const shell = useCanvasShell();
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;
  const { view } = shell;
  const viewport = useViewport();

  // Live mirror of the view used by gesture handlers.
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const mediaRef = useRef<CanvasMedia[]>(media);
  mediaRef.current = media;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;

  const [segments, setSegments] = useState<Record<string, SegmentState>>({});
  const [selectedMask, setSelectedMask] = useState<MaskIdentity | null>(null);
  const [soloTag, setSoloTag] = useState<string | null>(null);
  const [pendingBoxLabel, setPendingBoxLabel] =
    useState<PendingBoxLabel | null>(null);
  const [userBoxes, setUserBoxes] = useState<Record<string, UserBox[]>>({});

  const [multiHighlightInput, setMultiHighlightInput] = useState<string[]>([]);
  const [highlightInputs, setHighlightInputs] = useState<
    Record<string, string[]>
  >({});

  const [contextMenu, setContextMenu] = useState<
    { id: string; x: number; y: number } | null
  >(null);

  const { remember: rememberSavedTag } = useSavedTags(projectId);

  const initialHadStoredView = useRef<boolean>(
    readStoredView(VISION_VIEW_STORAGE_KEY) !== null,
  );
  const initialMediaLoadedRef = useRef<boolean>(false);

  // Hover + tool mode (own their own state).
  const { hoverId, setHoverId, clearHideTimer, scheduleHide } = useHoverState();
  const { tool, setTool, toolRef } = useToolMode();

  // Provider-owned drag ref (consumed by gestures and useVisibleMedia).
  const dragRef = useRef<DragState | null>(null);

  const { stackOrder, bringToFront } = useStackOrder({
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

  const { uploadStatus, encodingIds, runUploadPlan, abortUpload } =
    useUploadPipeline({
      projectId,
      sam3Available,
      setMedia,
      setPriorityIds,
      setConn,
      history,
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

  // Marquee gesture (owns marqueeRect/marqueeRef).
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

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setLastSelectedId(null);
    setSelectedMask(null);
    setSoloTag(null);
  }, []);
  clearSelectionRef.current = clearSelection;

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
    segments,
    setSegments,
    selectedMask,
    setSelectedMask,
    soloTag,
    setSoloTag,
  });
  const {
    segmentsRef,
    hoveredMask,
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
  } = segmentation;

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

  // Pointer gestures.
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

  // C6: Import preview + drop handler.
  const preview = useImportPreview();
  const { handleDrop, onConfirmImport } = useDropHandler({
    projectId,
    canvasRef,
    mediaRef,
    runUploadPlan,
    setSegments,
    preview,
  });

  // Register the drop handler with the shell.
  useEffect(() => {
    shell.setDropHandler(handleDrop);
    return () => shell.setDropHandler(null);
  }, [shell, handleDrop]);

  // Register the marquee background-pointer handler with the shell.
  useEffect(() => {
    shell.setBackgroundPointerDown(handleBackgroundPointerDown);
    return () => shell.setBackgroundPointerDown(null);
  }, [shell, handleBackgroundPointerDown]);

  // Register fit-bounds for the bottom HUD's Reset button.
  const getFitBounds = useFitBounds<CanvasMedia>(
    media,
    useCallback((m: CanvasMedia) => ({ w: m.width, h: m.height }), []),
  );
  useEffect(() => {
    shell.setFitBoundsGetter(getFitBounds);
    return () => shell.setFitBoundsGetter(null);
  }, [shell, getFitBounds]);

  // Trash sweep: hard-delete records soft-deleted more than an hour ago.
  useTrashSweep({ projectId, conn });

  // Media interaction handlers (consumed by MediaItem and BakeForImage).
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

  // Canvas-wide keyboard shortcuts (Escape, Tab, Cmd-A, Cmd-D, Delete, V/B, etc.).
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

  const value: VisionCanvasValue = {
    conn,
    setConn,
    sam3Error,
    sam3Available,
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
    lodCache,
    lodSources,
    setPriorityIds,
    dropAsset,
    stackOrder,
    bringToFront,
    selectedIds,
    setSelectedIds,
    selectedIdsRef,
    lastSelectedId,
    setLastSelectedId,
    lastSelectedIdRef,
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
    segments,
    setSegments,
    segmentsRef,
    selectedMask,
    setSelectedMask,
    hoveredMask,
    soloTag,
    setSoloTag,
    pendingBoxLabel,
    setPendingBoxLabel,
    userBoxes,
    setUserBoxes,
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
    tool,
    setTool,
    toolRef,
    hoverId,
    setHoverId,
    clearHideTimer,
    scheduleHide,
    marqueeRect,
    marqueeRef,
    handleBackgroundPointerDown,
    drawBoxPreview,
    beginDraw,
    activeResize,
    handleBboxResizePointerDown,
    handleBboxResizePointerMove,
    handleBboxResizePointerUp,
    dragRef,
    shiftToggledRef,
    beginDrag,
    handleMediaPointerMove,
    handleMediaPointerUp,
    multiHighlightInput,
    setMultiHighlightInput,
    highlightInputs,
    setHighlightInputs,
    preview,
    onConfirmImport,
    contextMenu,
    setContextMenu,
    handleMediaEnter,
    handleMediaLeave,
    handleMediaClick,
    handleMediaDoubleClick,
    handleMediaContextMenu,
    handleSidebarSelect,
    handleMediaPointerDown,
  };

  return (
    <VisionCanvasContextProvider value={value}>
      {children}
    </VisionCanvasContextProvider>
  );
}
