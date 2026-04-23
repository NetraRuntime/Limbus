import { describe, it, expect } from 'vitest';
import { findSegByTag, segIdsToPrune, groupSegmentationsByImage, type SegmentationRow } from './segmentations';

const mkRow = (id: string, tag: string): SegmentationRow => ({
  id,
  image: 'img1',
  tag,
  masks: [],
  source_width: 0,
  source_height: 0,
});

describe('findSegByTag', () => {
  it('returns the row whose tag matches case-insensitively', () => {
    const rows = [mkRow('r1', 'Cat'), mkRow('r2', 'dog')];
    expect(findSegByTag(rows, 'cat')?.id).toBe('r1');
    expect(findSegByTag(rows, 'DOG')?.id).toBe('r2');
  });

  it('returns undefined when no tag matches', () => {
    const rows = [mkRow('r1', 'Cat')];
    expect(findSegByTag(rows, 'bird')).toBeUndefined();
  });

  it('returns the first match when duplicates exist', () => {
    const rows = [mkRow('r1', 'cat'), mkRow('r2', 'CAT')];
    expect(findSegByTag(rows, 'Cat')?.id).toBe('r1');
  });
});

describe('segIdsToPrune', () => {
  it('returns ids of rows whose tag is not in tagsToKeep', () => {
    const rows = [
      mkRow('r1', 'cat'),
      mkRow('r2', 'dog'),
      mkRow('r3', 'tree'),
    ];
    expect(segIdsToPrune(rows, ['cat', 'dog'])).toEqual(['r3']);
  });

  it('matches case-insensitively', () => {
    const rows = [mkRow('r1', 'Cat'), mkRow('r2', 'DOG')];
    expect(segIdsToPrune(rows, ['cat'])).toEqual(['r2']);
  });

  it('returns every id when tagsToKeep is empty', () => {
    const rows = [mkRow('r1', 'cat'), mkRow('r2', 'dog')];
    expect(segIdsToPrune(rows, [])).toEqual(['r1', 'r2']);
  });

  it('returns [] when every row is kept', () => {
    const rows = [mkRow('r1', 'cat')];
    expect(segIdsToPrune(rows, ['cat', 'dog'])).toEqual([]);
  });
});

describe('groupSegmentationsByImage', () => {
  it('groups rows by image id, preserving tag order', () => {
    const rows: SegmentationRow[] = [
      { ...mkRow('r1', 'cat'), image: 'img1' },
      { ...mkRow('r2', 'dog'), image: 'img1' },
      { ...mkRow('r3', 'tree'), image: 'img2' },
    ];
    const grouped = groupSegmentationsByImage(rows);
    expect(Array.from(grouped.keys()).sort()).toEqual(['img1', 'img2']);
    expect(grouped.get('img1')!.map((r) => r.tag)).toEqual(['cat', 'dog']);
    expect(grouped.get('img2')!.map((r) => r.tag)).toEqual(['tree']);
  });

  it('returns an empty map for no rows', () => {
    expect(groupSegmentationsByImage([]).size).toBe(0);
  });
});
