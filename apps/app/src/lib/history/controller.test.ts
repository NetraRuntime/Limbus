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
});
