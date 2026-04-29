import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  STACK_ORDER_PERSIST_DEBOUNCE_MS,
  readStoredStackOrder,
  writeStoredStackOrder,
  type CanvasMedia,
} from '../lib';

type Args = {
  media: CanvasMedia[];
  /**
   * Gates the media→stackOrder sync until PocketBase hydration finishes.
   * `media` starts as [] while the PB list call is in flight — running
   * the sync against that empty transient would drop every hydrated id
   * and wipe persisted stacking order.
   */
  initialMediaLoadedRef: RefObject<boolean>;
};

export type StackOrderHook = {
  stackOrder: string[];
  setStackOrder: React.Dispatch<React.SetStateAction<string[]>>;
  /**
   * Raise the given ids to the top of the canvas stacking order by
   * moving them to the end of `stackOrder`. `media` itself is left
   * untouched so the sidebar (which renders `media` directly) does not
   * reshuffle.
   */
  bringToFront: (ids: Set<string>) => void;
};

export function useStackOrder({
  media,
  initialMediaLoadedRef,
}: Args): StackOrderHook {
  const [stackOrder, setStackOrder] = useState<string[]>(readStoredStackOrder);

  // Debounced persistence: write the current order to localStorage after
  // a short idle so a long drag-stack doesn't hammer storage.
  useEffect(() => {
    const t = window.setTimeout(
      () => writeStoredStackOrder(stackOrder),
      STACK_ORDER_PERSIST_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [stackOrder]);

  // Keep stackOrder in step with media membership: new items append to
  // the top of the stack, deleted items fall out. Relative order of
  // already-tracked items is preserved so prior raises persist.
  useEffect(() => {
    if (!initialMediaLoadedRef.current) return;
    setStackOrder((prev) => {
      const currentIds = new Set(media.map((m) => m.id));
      const kept = prev.filter((id) => currentIds.has(id));
      const keptSet = new Set(kept);
      const added: string[] = [];
      for (const m of media) {
        if (!keptSet.has(m.id)) added.push(m.id);
      }
      if (added.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...added];
    });
    // initialMediaLoadedRef is a ref; only `media` triggers re-evaluation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  const bringToFront = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    setStackOrder((prev) => {
      if (prev.length <= 1) return prev;
      const below: string[] = [];
      const raised: string[] = [];
      for (const id of prev) {
        if (ids.has(id)) raised.push(id);
        else below.push(id);
      }
      if (raised.length === 0 || raised.length === prev.length) return prev;
      let alreadyAtEnd = true;
      for (let i = 0; i < raised.length; i++) {
        if (prev[below.length + i] !== raised[i]) {
          alreadyAtEnd = false;
          break;
        }
      }
      if (alreadyAtEnd) return prev;
      return [...below, ...raised];
    });
  }, []);

  return { stackOrder, setStackOrder, bringToFront };
}
