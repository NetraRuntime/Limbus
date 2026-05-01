import { useVisionCanvas } from '../VisionCanvasContext';

export function useVisionMedia() {
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
    lodCache,
    lodSources,
    setPriorityIds,
    dropAsset,
    stackOrder,
    bringToFront,
  } = useVisionCanvas();
  return {
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
  };
}
