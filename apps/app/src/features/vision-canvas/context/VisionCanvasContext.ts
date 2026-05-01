import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { CanvasMedia, ConnState } from '../lib';
import type { useUploadPipeline } from '../hooks/useUploadPipeline';
import type { useLodSetup } from '../hooks/useLodSetup';
import type { useVisibleMedia } from '../hooks/useVisibleMedia';
import type { useStackOrder } from '../hooks/useStackOrder';

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
