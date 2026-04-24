import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/pb', () => ({
  upsertSegmentation: vi.fn(async () => ({})),
}));

import { resizeBboxEntry } from './resizeBboxEntry';
import type { ReadyMaskEntry } from './deleteMaskEntry';
import { upsertSegmentation } from '../../lib/pb';

const upsertMock = vi.mocked(upsertSegmentation);

const mask = (
  bbox: [number, number, number, number],
): ReadyMaskEntry['response']['masks'][number] => ({
  png_base64: 'p',
  width: 10,
  height: 10,
  score: 0.9,
  bbox,
});

const makeReady = (
  tag: string,
  masks: ReadyMaskEntry['response']['masks'],
): ReadyMaskEntry => ({
  tag,
  status: 'ready',
  response: { masks, source_width: 100, source_height: 100 },
});

describe('resizeBboxEntry', () => {
  beforeEach(() => {
    upsertMock.mockClear();
  });

  it('do replaces tag with the "after" snapshot and upserts', async () => {
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask([0, 0, 10, 10])]);
    const after = makeReady('cat', [mask([0, 0, 20, 15])]);

    const entry = resizeBboxEntry({
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
      before,
      after,
      replaceTag,
      onConn,
    });

    entry.do();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', after);
    await vi.waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith({
      image: 'img1',
      tag: 'cat',
      masks: after.response.masks,
      source_width: 100,
      source_height: 100,
    });
    expect(onConn).toHaveBeenLastCalledWith('ready');
  });

  it('undo restores the "before" snapshot and re-upserts', async () => {
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask([0, 0, 10, 10])]);
    const after = makeReady('cat', [mask([0, 0, 20, 15])]);

    const entry = resizeBboxEntry({
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
      before,
      after,
      replaceTag,
      onConn,
    });

    entry.undo();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', before);
    await vi.waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith({
      image: 'img1',
      tag: 'cat',
      masks: before.response.masks,
      source_width: 100,
      source_height: 100,
    });
  });

  it('flags connection offline when persistence rejects, but still applies state', async () => {
    upsertMock.mockRejectedValueOnce(new Error('boom'));
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask([0, 0, 10, 10])]);
    const after = makeReady('cat', [mask([0, 0, 20, 15])]);

    const entry = resizeBboxEntry({
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
      before,
      after,
      replaceTag,
      onConn,
    });

    entry.do();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', after);
    await vi.waitFor(() => expect(onConn).toHaveBeenLastCalledWith('offline'));
  });

  it('carries meta identifying the resize target', () => {
    const before = makeReady('Cat', [mask([0, 0, 10, 10])]);
    const after = makeReady('Cat', [mask([0, 0, 20, 15])]);
    const entry = resizeBboxEntry({
      imageId: 'img1',
      tag: 'Cat',
      maskIndex: 0,
      before,
      after,
      replaceTag: vi.fn(),
      onConn: vi.fn(),
    });
    expect(entry.meta).toEqual({
      kind: 'resize-bbox',
      imageId: 'img1',
      tag: 'Cat',
      maskIndex: 0,
    });
  });
});
