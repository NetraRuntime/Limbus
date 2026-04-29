import {
  HIGHLIGHT_INPUT_GAP,
  HIGHLIGHT_INPUT_HEIGHT,
} from '../components/HighlightInput';

export const HOVER_HIDE_MS = 160;
export const DRAG_THRESHOLD_PX = 4;
export const DRAW_BOX_MIN_SIZE_PX = 4;

// Disables viewport culling — mass remount on zoom-back blanks the WKWebView compositor.
export const CULL_BUFFER_FACTOR = 50;

export const EMPTY_TAGS: readonly string[] = Object.freeze([]);

export const HIGHLIGHT_BOTTOM_INSET_PX =
  HIGHLIGHT_INPUT_GAP + HIGHLIGHT_INPUT_HEIGHT + 16;

export const STACK_ORDER_STORAGE_KEY = 'netrart:canvas:stack-order:v1';
export const STACK_ORDER_PERSIST_DEBOUNCE_MS = 200;

export const VISION_VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';

export const DEFAULT_UPLOAD_LONGEST_SIDE = 640;

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const genBoxId = (): string =>
  `ub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
