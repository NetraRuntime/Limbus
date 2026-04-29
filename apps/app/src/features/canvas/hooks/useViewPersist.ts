import { useEffect } from 'react';
import {
  VIEW_PERSIST_DEBOUNCE_MS,
  writeStoredView,
} from '../../../lib/canvasView';
import type { View } from '../../../InfiniteCanvas';

/** Debounced write of the current view to localStorage. */
export function useViewPersist(view: View): void {
  useEffect(() => {
    const t = window.setTimeout(
      () => writeStoredView(view),
      VIEW_PERSIST_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [view]);
}
