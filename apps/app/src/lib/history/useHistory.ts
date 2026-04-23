import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createHistoryController } from './controller';
import type {
  HistoryController,
  HistoryOptions,
  HistorySnapshot,
} from './types';

export type UseHistoryReturn<M = unknown> = HistoryController<M> & HistorySnapshot;

/** React wrapper around `createHistoryController`. The controller instance is
 *  stable across renders; `canUndo` / `canRedo` track the controller's
 *  `getSnapshot()` via `useSyncExternalStore` so React components re-render on
 *  stack changes. `opts.onError` is read through a ref so callers can pass
 *  inline callbacks without recreating the controller. */
export function useHistory<M = unknown>(
  opts: HistoryOptions = {},
): UseHistoryReturn<M> {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const controller = useMemo(
    () =>
      createHistoryController<M>({
        limit: opts.limit,
        onError: (err, phase) => optsRef.current.onError?.(err, phase),
      }),
    // limit is captured once at mount; callers that need a different limit
    // should re-mount the component. onError is proxied through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  return {
    push: controller.push,
    undo: controller.undo,
    redo: controller.redo,
    clear: controller.clear,
    subscribe: controller.subscribe,
    getSnapshot: controller.getSnapshot,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
  };
}
