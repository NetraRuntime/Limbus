import { useVisionCanvas } from '../VisionCanvasContext';

export function useVisionSelection() {
  const {
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
  } = useVisionCanvas();
  return {
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
}
