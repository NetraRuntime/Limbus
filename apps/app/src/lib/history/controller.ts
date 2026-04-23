import type {
  HistoryController,
  HistoryEntry,
  HistoryOptions,
  HistorySnapshot,
} from './types';

export function createHistoryController<M = unknown>(
  opts: HistoryOptions = {},
): HistoryController<M> {
  const limit = opts.limit ?? 100;
  let past: HistoryEntry<M>[] = [];
  let future: HistoryEntry<M>[] = [];
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const fn of listeners) fn();
  };

  const runSafe = async (
    fn: () => void | Promise<void>,
    phase: 'do' | 'undo' | 'evict',
  ): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (err) {
      opts.onError?.(err, phase);
      return false;
    }
  };

  const evict = (entry: HistoryEntry<M>): void => {
    if (!entry.onEvict) return;
    void runSafe(entry.onEvict, 'evict');
  };

  const push = (
    entry: HistoryEntry<M>,
    pushOpts?: { alreadyApplied?: boolean },
  ): void => {
    if (!pushOpts?.alreadyApplied) void runSafe(entry.do, 'do');
    past.push(entry);
    // Enforce the limit.
    while (past.length > limit) {
      const dropped = past.shift();
      if (dropped) evict(dropped);
    }
    // Clear future on any new push. Entries in future have been undone —
    // their side effects were already reversed, so onEvict must NOT fire:
    // a delete entry in future has had its record restored, and committing
    // the soft-delete there would hard-delete a record that's now live.
    if (future.length > 0) future = [];
    emit();
  };

  let busy: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void>): Promise<void> => {
    const next = busy.then(fn, fn);
    busy = next.catch(() => {});
    return next;
  };

  const undo = (): Promise<void> =>
    queue(async () => {
      const entry = past[past.length - 1];
      if (!entry) return;
      past = past.slice(0, -1);
      future.push(entry);
      emit();
      const ok = await runSafe(entry.undo, 'undo');
      if (!ok) {
        const idx = future.lastIndexOf(entry);
        if (idx !== -1) future.splice(idx, 1);
        past.push(entry);
        emit();
      }
    });

  const redo = (): Promise<void> =>
    queue(async () => {
      const entry = future[future.length - 1];
      if (!entry) return;
      future = future.slice(0, -1);
      past.push(entry);
      emit();
      const ok = await runSafe(entry.do, 'do');
      if (!ok) {
        const idx = past.lastIndexOf(entry);
        if (idx !== -1) past.splice(idx, 1);
        future.push(entry);
        emit();
      }
    });

  const clear = (): void => {
    // Only past entries represent applied actions with deferred side effects
    // to commit. Future entries have been undone; evicting them would undo
    // the reversal (e.g. hard-delete a record an undo just restored).
    const drainedPast = past;
    past = [];
    future = [];
    for (const e of drainedPast) evict(e);
    emit();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // `useSyncExternalStore` compares snapshots by reference, so return a
  // cached object whose identity only changes when the booleans flip.
  let snapshot: HistorySnapshot = { canUndo: false, canRedo: false };
  const getSnapshot = (): HistorySnapshot => {
    const canUndo = past.length > 0;
    const canRedo = future.length > 0;
    if (canUndo !== snapshot.canUndo || canRedo !== snapshot.canRedo) {
      snapshot = { canUndo, canRedo };
    }
    return snapshot;
  };

  return { push, undo, redo, clear, subscribe, getSnapshot };
}
