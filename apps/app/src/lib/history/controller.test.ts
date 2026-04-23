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

    // 'a' pushed first (shorter delay), 'b' pushed second (longer delay).
    // The first undo pops 'b' — its 40ms timer should finish before 'a' runs.
    // Without serialization, 'a' (10ms) would finish first and order would
    // come out ['a', 'b']. The queue forces ['b', 'a'].
    c.push(
      { label: 'a', do: () => {}, undo: delayedUndo('a', 10) },
      { alreadyApplied: true },
    );
    c.push(
      { label: 'b', do: () => {}, undo: delayedUndo('b', 40) },
      { alreadyApplied: true },
    );

    // Fire two undos back-to-back without awaiting the first.
    const p1 = c.undo();
    const p2 = c.undo();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['b', 'a']);
  });

  it('surfaces undo errors via onError and rolls the entry back to past', async () => {
    const onError = vi.fn();
    const c = createHistoryController({ onError });
    const failing: HistoryEntry = {
      label: 'boom',
      do: vi.fn(),
      undo: vi.fn().mockRejectedValueOnce(new Error('PB offline')),
    };

    c.push(failing, { alreadyApplied: true });
    await c.undo();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'undo');
    // Entry stays retryable — still in past, future empty.
    expect(c.getSnapshot()).toEqual({ canUndo: true, canRedo: false });
  });

  it('surfaces redo errors via onError and rolls the entry back to future', async () => {
    const onError = vi.fn();
    const c = createHistoryController({ onError });
    const doFn = vi.fn().mockRejectedValueOnce(new Error('PB offline'));
    const entry: HistoryEntry = {
      label: 'boom',
      do: doFn,
      undo: vi.fn(),
    };

    c.push(entry, { alreadyApplied: true });
    await c.undo();
    await c.redo();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'do');
    expect(c.getSnapshot()).toEqual({ canUndo: false, canRedo: true });
  });

  it('push with alreadyApplied: true does not call do, but redo does', async () => {
    const c = createHistoryController();
    const doSpy = vi.fn();
    const undoSpy = vi.fn();
    const entry: HistoryEntry = { label: 'x', do: doSpy, undo: undoSpy };

    c.push(entry, { alreadyApplied: true });
    expect(doSpy).not.toHaveBeenCalled();

    await c.undo();
    expect(undoSpy).toHaveBeenCalledTimes(1);

    await c.redo();
    expect(doSpy).toHaveBeenCalledTimes(1);
  });

  it('push without alreadyApplied calls do immediately', () => {
    const c = createHistoryController();
    const doSpy = vi.fn();
    c.push({ label: 'x', do: doSpy, undo: vi.fn() });
    expect(doSpy).toHaveBeenCalledTimes(1);
  });
});
