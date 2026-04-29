import { useEffect } from 'react';
import { isTypingContext } from '../dom/isTypingContext';
import type { HistoryController } from './types';

/** Cmd/Ctrl-Z, -Shift-Z, -Y at window capture; skips typing contexts to preserve native text undo. */
export function useHistoryShortcuts<M = unknown>(
  history: HistoryController<M>,
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (isTypingContext(e)) return;
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        void history.redo();
        return;
      }
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void history.undo();
        return;
      }
      if (key === 'y' && !e.shiftKey) {
        e.preventDefault();
        void history.redo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [history]);
}
