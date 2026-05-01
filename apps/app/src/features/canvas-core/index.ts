export {
  InfiniteCanvas,
  type View,
  type WorldPoint,
  type WorldRect,
  type FocusOptions,
  type InfiniteCanvasHandle,
  type BackgroundPointerDown,
} from './InfiniteCanvas';

export {
  VIEW_PERSIST_DEBOUNCE_MS,
  formatCoord,
  formatZoom,
  getInitialView,
  readStoredView,
  writeStoredView,
} from './lib/canvasView';

export { useCanvasGlass, type CanvasGlass } from './hooks/useCanvasGlass';
export { useCanvasTitle } from './hooks/useCanvasTitle';
export { useViewport, type Viewport } from './hooks/useViewport';
export { useViewPersist } from './hooks/useViewPersist';
export { useFitBounds } from './hooks/useFitBounds';

export { CanvasTitlebar } from './components/CanvasTitlebar';
export { CanvasTopHud } from './components/CanvasTopHud';
export { CanvasBottomHud } from './components/CanvasBottomHud';
export { CanvasAppControlsHud } from './components/CanvasAppControlsHud';
export { DropErrorToast } from './components/DropErrorToast';
