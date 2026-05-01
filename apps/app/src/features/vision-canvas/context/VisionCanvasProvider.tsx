import { useRef, useState, type ReactNode } from 'react';
import {
  readStoredView,
  useCanvasPage,
  useCanvasShell,
  useViewport,
  type InfiniteCanvasHandle,
} from '../../canvas-core';
import { useStackOrder } from '../hooks/useStackOrder';
import { useVisibleMedia } from '../hooks/useVisibleMedia';
import { useLodSetup } from '../hooks/useLodSetup';
import { useUploadPipeline } from '../hooks/useUploadPipeline';
import { useCanvasHydration } from '../hooks/useCanvasHydration';
import {
  VISION_VIEW_STORAGE_KEY,
  type CanvasMedia,
  type ConnState,
  type DragState,
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
  selectedIds: Set<string>;
  hoverId: string | null;
  children: ReactNode;
};

export function VisionCanvasProvider({
  conn,
  setConn,
  sam3Error,
  setSegments,
  dragRef,
  selectedIds,
  hoverId,
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

  const initialHadStoredView = useRef<boolean>(
    readStoredView(VISION_VIEW_STORAGE_KEY) !== null,
  );
  const initialMediaLoadedRef = useRef<boolean>(false);

  const { stackOrder } = useStackOrder({
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
  };

  return (
    <VisionCanvasContextProvider value={value}>
      {children}
    </VisionCanvasContextProvider>
  );
}
