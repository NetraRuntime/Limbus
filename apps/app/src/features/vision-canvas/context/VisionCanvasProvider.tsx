import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  readStoredView,
  useCanvasPage,
  useCanvasShell,
  useViewport,
  type InfiniteCanvasHandle,
} from '../../canvas-core';
import type { MaskIdentity } from '../../segmentation';
import { useStackOrder } from '../hooks/useStackOrder';
import { useVisibleMedia } from '../hooks/useVisibleMedia';
import { useLodSetup } from '../hooks/useLodSetup';
import { useUploadPipeline } from '../hooks/useUploadPipeline';
import { useCanvasHydration } from '../hooks/useCanvasHydration';
import { useSelectionDerived } from '../hooks/useSelectionDerived';
import { useSelectionActions } from '../hooks/useSelectionActions';
import type { MarqueeRect } from '../hooks/useMarqueeGesture';
import {
  VISION_VIEW_STORAGE_KEY,
  type CanvasMedia,
  type ConnState,
  type DragState,
  type MarqueeState,
  type SegmentState,
} from '../lib';
import {
  VisionCanvasContextProvider,
  type VisionCanvasValue,
} from './VisionCanvasContext';

type Props = {
  conn: ConnState;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  sam3Error: string | null;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
  dragRef: React.MutableRefObject<DragState | null>;
  hoverId: string | null;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  marqueeRect: MarqueeRect;
  marqueeRef: React.MutableRefObject<MarqueeState | null>;
  setSelectedMask: React.Dispatch<React.SetStateAction<MaskIdentity | null>>;
  setSoloTag: React.Dispatch<React.SetStateAction<string | null>>;
  clearSegment: (id: string) => void;
  setMultiHighlightInput: React.Dispatch<React.SetStateAction<string[]>>;
  children: ReactNode;
};

export function VisionCanvasProvider({
  conn,
  setConn,
  sam3Error,
  setSegments,
  dragRef,
  hoverId,
  setHoverId,
  marqueeRect,
  marqueeRef,
  setSelectedMask,
  setSoloTag,
  clearSegment,
  setMultiHighlightInput,
  children,
}: Props) {
  const sam3Available = !sam3Error;
  const { projectId, history } = useCanvasPage();
  const shell = useCanvasShell();
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;
  const { view } = shell;
  const viewport = useViewport();

  const [media, setMedia] = useState<CanvasMedia[]>([]);
  const mediaRef = useRef<CanvasMedia[]>(media);
  mediaRef.current = media;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;

  const initialHadStoredView = useRef<boolean>(
    readStoredView(VISION_VIEW_STORAGE_KEY) !== null,
  );
  const initialMediaLoadedRef = useRef<boolean>(false);

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

  const clearSelectionRef = useRef<() => void>(() => {});
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
  };

  return (
    <VisionCanvasContextProvider value={value}>
      {children}
    </VisionCanvasContextProvider>
  );
}
