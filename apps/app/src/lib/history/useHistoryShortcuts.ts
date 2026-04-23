import { useEffect } from 'react';
import { isTypingContext } from '../dom/isTypingContext';
import type { HistoryController } from './types';

/** Binds Cmd/Ctrl-Z (undo), Cmd/Ctrl-Shift-Z (redo), Cmd/Ctrl-Y (redo) at the
 *  window level, capture phase. Typing contexts (inputs, textareas,
 *  contenteditable) are ignored so the browser's default undo for text edits
 *  keeps working. */
export function useHistoryShortcuts(history: HistoryController<unknown>): void {
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
