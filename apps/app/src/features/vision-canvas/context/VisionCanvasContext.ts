import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { BackgroundPointerDown } from '../../canvas-core';
import type { MaskIdentity } from '../../segmentation';
import type {
  CanvasMedia,
  ConnState,
  DragState,
  PendingBoxLabel,
  SegmentState,
  UserBox,
} from '../lib';
import type { useUploadPipeline } from '../hooks/useUploadPipeline';
import type { useLodSetup } from '../hooks/useLodSetup';
import type { useVisibleMedia } from '../hooks/useVisibleMedia';
import type { useStackOrder } from '../hooks/useStackOrder';
import type { SelectionDerived } from '../hooks/useSelectionDerived';
import type { SelectionActions } from '../hooks/useSelectionActions';
import type { SegmentationState } from '../hooks/useSegmentationState';
import type { useToolMode } from '../hooks/useToolMode';
import type { MarqueeGesture } from '../hooks/useMarqueeGesture';
import type { DrawBoxGesture } from '../hooks/useDrawBoxGesture';
import type { BboxResizeGesture } from '../hooks/useBboxResizeGesture';
import type { MediaDragGesture } from '../hooks/useMediaDragGesture';

export type VisionCanvasValue = {
  // C1: connection + sam3
  conn: ConnState;
  setConn: Dispatch<SetStateAction<ConnState>>;
  sam3Error: string | null;
  sam3Available: boolean;

  // C2: media + hydration + upload + lod
  media: CanvasMedia[];
  setMedia: Dispatch<SetStateAction<CanvasMedia[]>>;
  mediaRef: MutableRefObject<CanvasMedia[]>;
  paintMedia: ReturnType<typeof useVisibleMedia>['paintMedia'];
  visibleMedia: ReturnType<typeof useVisibleMedia>['visibleMedia'];
  labelPlacements: ReturnType<typeof useVisibleMedia>['labelPlacements'];
  uploadStatus: ReturnType<typeof useUploadPipeline>['uploadStatus'];
  encodingIds: ReturnType<typeof useUploadPipeline>['encodingIds'];
  runUploadPlan: ReturnType<typeof useUploadPipeline>['runUploadPlan'];
  abortUpload: ReturnType<typeof useUploadPipeline>['abortUpload'];
  lodCache: ReturnType<typeof useLodSetup>['lodCache'];
  lodSources: ReturnType<typeof useLodSetup>['lodSources'];
  setPriorityIds: ReturnType<typeof useLodSetup>['setPriorityIds'];
  dropAsset: ReturnType<typeof useLodSetup>['dropAsset'];
  stackOrder: ReturnType<typeof useStackOrder>['stackOrder'];
  bringToFront: ReturnType<typeof useStackOrder>['bringToFront'];

  // C3: selection state + derived + actions
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  selectedIdsRef: MutableRefObject<Set<string>>;
  lastSelectedId: string | null;
  setLastSelectedId: Dispatch<SetStateAction<string | null>>;
  lastSelectedIdRef: MutableRefObject<string | null>;
  activeSet: SelectionDerived['activeSet'];
  activeId: SelectionDerived['activeId'];
  activeMedia: SelectionDerived['activeMedia'];
  selectionBBox: SelectionDerived['selectionBBox'];
  multiSelectKey: SelectionDerived['multiSelectKey'];
  clearSelection: () => void;
  clearSelectionRef: MutableRefObject<() => void>;
  selectAll: SelectionActions['selectAll'];
  duplicateSelection: SelectionActions['duplicateSelection'];
  deleteMediaById: SelectionActions['deleteMediaById'];
  deleteSelection: SelectionActions['deleteSelection'];

  // C4: segmentation state + derived + actions
  segments: Record<string, SegmentState>;
  setSegments: Dispatch<SetStateAction<Record<string, SegmentState>>>;
  segmentsRef: SegmentationState['segmentsRef'];
  selectedMask: MaskIdentity | null;
  setSelectedMask: Dispatch<SetStateAction<MaskIdentity | null>>;
  hoveredMask: MaskIdentity | null;
  soloTag: string | null;
  setSoloTag: Dispatch<SetStateAction<string | null>>;
  pendingBoxLabel: PendingBoxLabel | null;
  setPendingBoxLabel: Dispatch<SetStateAction<PendingBoxLabel | null>>;
  userBoxes: Record<string, UserBox[]>;
  setUserBoxes: Dispatch<SetStateAction<Record<string, UserBox[]>>>;
  handleMaskSelect: SegmentationState['handleMaskSelect'];
  handleMaskHover: SegmentationState['handleMaskHover'];
  clearSegment: SegmentationState['clearSegment'];
  replaceReadyTag: SegmentationState['replaceReadyTag'];
  deleteMask: SegmentationState['deleteMask'];
  deleteAllMasksForTag: SegmentationState['deleteAllMasksForTag'];
  removeSegmentTag: SegmentationState['removeSegmentTag'];
  submitSegment: SegmentationState['submitSegment'];
  confirmPendingBoxLabel: SegmentationState['confirmPendingBoxLabel'];
  cancelPendingBoxLabel: SegmentationState['cancelPendingBoxLabel'];

  // C5: tools + gestures + hover + highlight inputs
  tool: ReturnType<typeof useToolMode>['tool'];
  setTool: ReturnType<typeof useToolMode>['setTool'];
  toolRef: ReturnType<typeof useToolMode>['toolRef'];

  hoverId: string | null;
  setHoverId: Dispatch<SetStateAction<string | null>>;
  clearHideTimer: () => void;
  scheduleHide: () => void;

  marqueeRect: MarqueeGesture['marqueeRect'];
  marqueeRef: MarqueeGesture['marqueeRef'];
  handleBackgroundPointerDown: (e: BackgroundPointerDown) => void;

  drawBoxPreview: DrawBoxGesture['drawBoxPreview'];
  beginDraw: DrawBoxGesture['beginDraw'];

  activeResize: BboxResizeGesture['activeResize'];
  handleBboxResizePointerDown: BboxResizeGesture['handlePointerDown'];
  handleBboxResizePointerMove: BboxResizeGesture['handlePointerMove'];
  handleBboxResizePointerUp: BboxResizeGesture['handlePointerUp'];

  dragRef: MutableRefObject<DragState | null>;
  shiftToggledRef: MediaDragGesture['shiftToggledRef'];
  beginDrag: MediaDragGesture['beginDrag'];
  handleMediaPointerMove: MediaDragGesture['handlePointerMove'];
  handleMediaPointerUp: MediaDragGesture['handlePointerUp'];

  multiHighlightInput: string[];
  setMultiHighlightInput: Dispatch<SetStateAction<string[]>>;
  highlightInputs: Record<string, string[]>;
  setHighlightInputs: Dispatch<SetStateAction<Record<string, string[]>>>;
};

const Ctx = createContext<VisionCanvasValue | null>(null);
Ctx.displayName = 'VisionCanvasContext';

export const VisionCanvasContextProvider = Ctx.Provider;

export function useVisionCanvas(): VisionCanvasValue {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('useVisionCanvas must be used inside a VisionCanvasProvider.');
  }
  return value;
}
