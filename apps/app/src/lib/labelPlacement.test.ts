import { describe, it, expect } from 'vitest';
import {
  computeLabelPlacements,
  type PlacementInput,
} from './labelPlacement';

type Item = PlacementInput['items'][number];
const item = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  name = id,
): Item => ({ id, x, y, width: w, height: h, name });

const fixedLabel = () => 100;
const base = {
  scale: 1 as const,
  labelWidth: fixedLabel,
};

const withRank = (order: string[]) => (id: string) => order.indexOf(id);

describe('computeLabelPlacements', () => {
  it('returns empty map for no items', () => {
    const out = computeLabelPlacements({
      items: [],
      rank: () => -1,
      ...base,
    });
    expect(out.size).toBe(0);
  });

  it('single item gets tl', () => {
    const out = computeLabelPlacements({
      items: [item('a', 0, 0, 200, 200)],
      rank: withRank(['a']),
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('ignores a lower-ranked neighbor overlapping the default slot', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 0, 400, 180),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['b', 'a']),
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('flips to tr when a higher-ranked neighbor blocks tl', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b']),
      ...base,
    });
    expect(out.get('a')).toBe('tr');
  });

  it('flips to bl when both tl and tr are blocked above', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
      item('c', 280, 150, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c']),
      ...base,
    });
    expect(out.get('a')).toBe('bl');
  });

  it('flips to br when tl, tr, and bl are blocked', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
      item('c', 280, 150, 120, 60),
      item('d', 0, 405, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c', 'd']),
      ...base,
    });
    expect(out.get('a')).toBe('br');
  });

  it('falls back to tl when all four corners are blocked', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
      item('c', 280, 150, 120, 60),
      item('d', 0, 405, 120, 60),
      item('e', 280, 405, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: withRank(['a', 'b', 'c', 'd', 'e']),
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('treats equal rank as "not higher" (strict inequality)', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 0, 150, 120, 60),
    ];
    const out = computeLabelPlacements({
      items,
      rank: () => 0,
      ...base,
    });
    expect(out.get('a')).toBe('tl');
  });

  it('scale shrinks the label world-rect, freeing up candidates', () => {
    const items = [
      item('a', 0, 200, 400, 200),
      item('b', 40, 150, 200, 60),
    ];
    const rank = withRank(['a', 'b']);
    const zoomedIn = computeLabelPlacements({
      items,
      rank,
      scale: 10,
      labelWidth: fixedLabel,
    });
    expect(zoomedIn.get('a')).toBe('tl');
  });
});
