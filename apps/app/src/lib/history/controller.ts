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
    // Clear future on any new push.
    if (future.length > 0) {
      const drained = future;
      future = [];
      for (const e of drained) evict(e);
    }
    emit();
  };

  const undo = async (): Promise<void> => {
    const entry = past[past.length - 1];
    if (!entry) return;
    past = past.slice(0, -1);
    future.push(entry);
    emit();
    const ok = await runSafe(entry.undo, 'undo');
    if (!ok) {
      // Roll back the move so a retry re-attempts the undo.
      const idx = future.lastIndexOf(entry);
      if (idx !== -1) future.splice(idx, 1);
      past.push(entry);
      emit();
    }
  };

  const redo = async (): Promise<void> => {
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
  };

  const clear = (): void => {
    const drained = [...past, ...future];
    past = [];
    future = [];
    for (const e of drained) evict(e);
    emit();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = (): HistorySnapshot => ({
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  });

  return { push, undo, redo, clear, subscribe, getSnapshot };
}
