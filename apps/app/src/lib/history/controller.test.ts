import { describe, it, expect, vi } from 'vitest';
import { createHistoryController } from './controller';
import type { HistoryEntry } from './types';

const makeEntry = (label: string): HistoryEntry & {
  doSpy: ReturnType<typeof vi.fn>;
  undoSpy: ReturnType<typeof vi.fn>;
  evictSpy: ReturnType<typeof vi.fn>;
} => {
  const doSpy = vi.fn();
  const undoSpy = vi.fn();
  const evictSpy = vi.fn();
  return {
    label,
    do: doSpy,
    undo: undoSpy,
    onEvict: evictSpy,
    doSpy,
    undoSpy,
    evictSpy,
  };
};

describe('createHistoryController', () => {
  it('push / undo / redo round-trip calls do and undo in order', async () => {
    const c = createHistoryController();
    const a = makeEntry('a');
    const b = makeEntry('b');
    const cc = makeEntry('c');

    c.push(a, { alreadyApplied: true });
    c.push(b, { alreadyApplied: true });
    c.push(cc, { alreadyApplied: true });
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: false });

    await c.undo();
    await c.undo();
    await c.undo();
    expect(cc.undoSpy).toHaveBeenCalledTimes(1);
    expect(b.undoSpy).toHaveBeenCalledTimes(1);
    expect(a.undoSpy).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toEqual({ canUndo: false, canRedo: true });

    await c.redo();
    await c.redo();
    await c.redo();
    expect(a.doSpy).toHaveBeenCalledTimes(1);
    expect(b.doSpy).toHaveBeenCalledTimes(1);
    expect(cc.doSpy).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: false });
  });

  it('evicts the oldest entry when past exceeds limit', () => {
    const c = createHistoryController({ limit: 2 });
    const a = makeEntry('a');
    const b = makeEntry('b');
    const cc = makeEntry('c');

    c.push(a, { alreadyApplied: true });
    c.push(b, { alreadyApplied: true });
    c.push(cc, { alreadyApplied: true });

    expect(a.evictSpy).toHaveBeenCalledTimes(1);
    expect(b.evictSpy).not.toHaveBeenCalled();
    expect(cc.evictSpy).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: false });
  });

  it('clears future and evicts each cleared entry when a new push happens', async () => {
    const c = createHistoryController();
    const a = makeEntry('a');
    const b = makeEntry('b');
    const cc = makeEntry('c');
    const d = makeEntry('d');

    c.push(a, { alreadyApplied: true });
    c.push(b, { alreadyApplied: true });
    c.push(cc, { alreadyApplied: true });
    await c.undo();
    await c.undo();
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: true });

    c.push(d, { alreadyApplied: true });

    expect(b.evictSpy).toHaveBeenCalledTimes(1);
    expect(cc.evictSpy).toHaveBeenCalledTimes(1);
    expect(a.evictSpy).not.toHaveBeenCalled();
    expect(d.evictSpy).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: false });
  });

  it('clear() drains past and future and evicts every entry', () => {
    const c = createHistoryController();
    const a = makeEntry('a');
    const b = makeEntry('b');
    c.push(a, { alreadyApplied: true });
    c.push(b, { alreadyApplied: true });

    c.clear();

    expect(a.evictSpy).toHaveBeenCalledTimes(1);
    expect(b.evictSpy).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot()).toEqual({ canUndo: false, canRedo: false });
  });

  it('serializes overlapping undo calls in order', async () => {
    const c = createHistoryController();
    const order: string[] = [];
    const delayedUndo = (label: string, ms: number) => () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(label);
          resolve();
        }, ms);
      });

    c.push(
      { label: 'a', do: () => {}, undo: delayedUndo('a', 40) },
      { alreadyApplied: true },
    );
    c.push(
      { label: 'b', do: () => {}, undo: delayedUndo('b', 10) },
      { alreadyApplied: true },
    );

    // Fire two undos back-to-back without awaiting the first.
    const p1 = c.undo();
    const p2 = c.undo();
    await Promise.all([p1, p2]);

    // Without serialization, 'a' (10ms) would finish before 'b' (40ms).
    // With serialization, 'b' must complete before 'a' starts.
    expect(order).toEqual(['b', 'a']);
  });
});
