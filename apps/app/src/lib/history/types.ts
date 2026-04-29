export type HistoryEntry<M = unknown> = {
  /** Re-apply the action. Called on redo and (when alreadyApplied is false) on push. */
  do: () => void | Promise<void>;
  /** Revert the action. Called on undo. */
  undo: () => void | Promise<void>;
  /** Fires when entry leaves past stack permanently (limit overflow or clear); never on future-stack drop. */
  onEvict?: () => void | Promise<void>;
  /** Human-readable label for dev logs and any future UI. */
  label: string;
  /** Free-form metadata for consumers. The controller never reads this. */
  meta?: M;
};

export type HistoryPhase = 'do' | 'undo' | 'evict';

export type HistoryOptions = {
  /** Max size of the `past` stack. Excess entries are evicted FIFO. Default 100. */
  limit?: number;
  /** Called when an entry's do/undo/onEvict rejects. */
  onError?: (err: unknown, phase: HistoryPhase) => void;
};

export type HistorySnapshot = {
  canUndo: boolean;
  canRedo: boolean;
};

export type HistoryController<M = unknown> = {
  push: (entry: HistoryEntry<M>, opts?: { alreadyApplied?: boolean }) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
  /** Subscription API — used by the React hook, not by product code. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => HistorySnapshot;
};
