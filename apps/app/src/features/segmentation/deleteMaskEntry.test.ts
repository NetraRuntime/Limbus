import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/pb', () => ({
  upsertSegmentation: vi.fn(async () => ({})),
  deleteSegmentationByImageTag: vi.fn(async () => {}),
}));

import { deleteMaskEntry, type ReadyMaskEntry } from './deleteMaskEntry';
import { upsertSegmentation, deleteSegmentationByImageTag } from '../../lib/pb';

const upsertMock = vi.mocked(upsertSegmentation);
const deleteTagMock = vi.mocked(deleteSegmentationByImageTag);

const mask = (id: string): ReadyMaskEntry['response']['masks'][number] => ({
  png_base64: id,
  width: 10,
  height: 10,
  score: 0.9,
  bbox: [0, 0, 10, 10],
});

const makeReady = (
  tag: string,
  masks: ReadyMaskEntry['response']['masks'],
): ReadyMaskEntry => ({
  tag,
  status: 'ready',
  response: { masks, source_width: 100, source_height: 100 },
});

describe('deleteMaskEntry', () => {
  beforeEach(() => {
    upsertMock.mockClear();
    deleteTagMock.mockClear();
  });

  it('do replaces tag entries with the "after" snapshot and upserts when masks remain', async () => {
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask('a'), mask('b')]);
    const after = makeReady('cat', [mask('a')]);

    const entry = deleteMaskEntry({
      projectId: 'proj1',
      imageId: 'img1',
      tag: 'cat',
      before,
      after,
      replaceTag,
      onConn,
    });

    entry.do();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', after);
    await vi.waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith('proj1', {
      image: 'img1',
      tag: 'cat',
      masks: after.response.masks,
      source_width: 100,
      source_height: 100,
    });
    expect(deleteTagMock).not.toHaveBeenCalled();
    expect(onConn).toHaveBeenLastCalledWith('ready');
  });

  it('do deletes the tag row when no masks remain', async () => {
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask('a')]);

    const entry = deleteMaskEntry({
      projectId: 'proj1',
      imageId: 'img1',
      tag: 'cat',
      before,
      after: null,
      replaceTag,
      onConn,
    });

    entry.do();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', null);
    await vi.waitFor(() =>
      expect(deleteTagMock).toHaveBeenCalledWith('proj1', 'img1', 'cat'),
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('undo restores the "before" snapshot and re-upserts', async () => {
    const replaceTag = vi.fn();
    const onConn = vi.fn();
    const before = makeReady('cat', [mask('a'), mask('b')]);

    const entry = deleteMaskEntry({
      projectId: 'proj1',
      imageId: 'img1',
      tag: 'cat',
      before,
      after: null,
      replaceTag,
      onConn,
    });

    entry.undo();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', before);
    await vi.waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(upsertMock).toHaveBeenCalledWith('proj1', {
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
    const before = makeReady('cat', [mask('a'), mask('b')]);
    const after = makeReady('cat', [mask('a')]);

    const entry = deleteMaskEntry({
      projectId: 'proj1',
      imageId: 'img1',
      tag: 'cat',
      before,
      after,
      replaceTag,
      onConn,
    });

    entry.do();
    expect(replaceTag).toHaveBeenCalledWith('img1', 'cat', after);
    await vi.waitFor(() =>
      expect(onConn).toHaveBeenLastCalledWith('offline'),
    );
  });

  it('carries meta identifying the deletion target', () => {
    const entry = deleteMaskEntry({
      projectId: 'proj1',
      imageId: 'img1',
      tag: 'Cat',
      before: makeReady('Cat', [mask('a')]),
      after: null,
      replaceTag: vi.fn(),
      onConn: vi.fn(),
    });
    expect(entry.meta).toEqual({
      kind: 'delete-mask',
      imageId: 'img1',
      tag: 'Cat',
    });
  });
});
