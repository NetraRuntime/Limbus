import { useCallback, useEffect, useRef, useState } from 'react';
import { HOVER_HIDE_MS } from '../lib';

/**
 * Hover-id state with a debounced clear. The hide timer survives a brief
 * pointer-leave/enter bounce (e.g. crossing between an image and its label
 * span) so the floating UI doesn't flicker.
 */
export function useHoverState() {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      setHoverId(null);
      hideTimer.current = null;
    }, HOVER_HIDE_MS);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return { hoverId, setHoverId, clearHideTimer, scheduleHide };
}
