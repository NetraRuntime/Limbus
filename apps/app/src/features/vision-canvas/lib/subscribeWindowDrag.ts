type DragHandlers = {
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
  onCancel?: (e: PointerEvent) => void;
};

/**
 * Wires the standard pointermove/up/cancel triplet to window and returns
 * an unsubscribe. `onCancel` defaults to `onUp` so callers don't have to
 * repeat themselves.
 */
export function subscribeWindowDrag(handlers: DragHandlers): () => void {
  const cancel = handlers.onCancel ?? handlers.onUp;
  window.addEventListener('pointermove', handlers.onMove);
  window.addEventListener('pointerup', handlers.onUp);
  window.addEventListener('pointercancel', cancel);
  return () => {
    window.removeEventListener('pointermove', handlers.onMove);
    window.removeEventListener('pointerup', handlers.onUp);
    window.removeEventListener('pointercancel', cancel);
  };
}
