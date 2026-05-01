export * from './lib';
export * from './components/layers';

export { MediaItem } from './components/MediaItem';
export { BakeForImage } from './components/BakeForImage';
export { BoxLabelPopover } from './components/BoxLabelPopover';
export { MediaToolbar } from './components/MediaToolbar';
export { MediaSearchPalette, type SearchItem } from './components/MediaSearchPalette';
export { MediaTagList } from './components/MediaTagList';
export { Sam3VersionBadge } from './components/Sam3VersionBadge';
export { TopHudExtra } from './components/TopHudExtra';
export {
  HighlightInput,
  HIGHLIGHT_INPUT_GAP,
  HIGHLIGHT_INPUT_HEIGHT,
} from './components/HighlightInput';
export { ImportPreviewModal } from './components/ImportPreviewModal';
export { SavedTagsPopover } from './components/SavedTagsPopover';
export {
  useSavedTags,
  colorForTag,
  sanitizeTag,
} from './components/savedTags';

export { useBboxResizeGesture } from './hooks/useBboxResizeGesture';
export { useBoxLabelKeyboard } from './hooks/useBoxLabelKeyboard';
export { useCanvasHydration } from './hooks/useCanvasHydration';
export { useCanvasKeyboardShortcuts } from './hooks/useCanvasKeyboardShortcuts';
export { useDrawBoxGesture } from './hooks/useDrawBoxGesture';
export { useDropHandler } from './hooks/useDropHandler';
export { useHoverState } from './hooks/useHoverState';
export { useLodSetup } from './hooks/useLodSetup';
export { useMarqueeGesture } from './hooks/useMarqueeGesture';
export { useMediaDragGesture } from './hooks/useMediaDragGesture';
export { useMediaHandlers } from './hooks/useMediaHandlers';
export { useSegmentationState } from './hooks/useSegmentationState';
export { useSelectionActions } from './hooks/useSelectionActions';
export { useSelectionDerived } from './hooks/useSelectionDerived';
export { useStackOrder } from './hooks/useStackOrder';
export { useToolMode } from './hooks/useToolMode';
export { useTrashSweep } from './hooks/useTrashSweep';
export { useUploadPipeline } from './hooks/useUploadPipeline';
export type { UploadPipeline } from './hooks/useUploadPipeline';
export { useVisibleMedia } from './hooks/useVisibleMedia';
export { useSam3Boot, type Sam3BootState } from './hooks/useSam3Boot';

export { VisionCanvasProvider } from './context/VisionCanvasProvider';
export {
  useVisionCanvas,
  type VisionCanvasValue,
} from './context/VisionCanvasContext';
export { useVisionMedia } from './context/slices/useVisionMedia';
export { useVisionConn } from './context/slices/useVisionConn';
export { useVisionSelection } from './context/slices/useVisionSelection';
export { useVisionSegmentation } from './context/slices/useVisionSegmentation';
export { useVisionTools } from './context/slices/useVisionTools';
export { useVisionImport } from './context/slices/useVisionImport';

export { VisionCanvasPage } from './VisionCanvasPage';
