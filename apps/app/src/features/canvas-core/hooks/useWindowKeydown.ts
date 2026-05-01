import { useEffect, useRef } from 'react';

type Options = {
  /** Use capture phase. Defaults to false. */
  capture?: boolean;
  /** When false the listener is detached. Useful for gating on `activeMedia`. */
  enabled?: boolean;
};

/**
 * Window-scoped keydown listener with stable subscription. The handler is
 * stored in a ref so callers don't have to memoize it for the listener to
 * survive renders; the useEffect only re-subscribes when capture/enabled
 * change.
 */
export function useWindowKeydown(
  handler: (e: KeyboardEvent) => void,
  options: Options = {},
) {
  const { capture = false, enabled = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [capture, enabled]);
}
