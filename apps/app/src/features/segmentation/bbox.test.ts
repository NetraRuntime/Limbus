import { describe, it, expect } from 'vitest';
import { scaleBboxToBake } from './bbox';

describe('scaleBboxToBake', () => {
  it('passes through when mask and bake dims are identical', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 100, 100, 100);
    expect(r).toEqual({ x: 10, y: 20, w: 20, h: 20 });
  });

  it('scales linearly when bake is larger than mask', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 100, 200, 200);
    expect(r).toEqual({ x: 20, y: 40, w: 40, h: 40 });
  });

  it('respects independent x/y scaling', () => {
    const r = scaleBboxToBake([10, 20, 30, 40], 100, 200, 200, 400);
    expect(r).not.toBeNull();
    expect(r!.x).toBe(20);
    expect(r!.y).toBe(40);
    expect(r!.w).toBe(40);
    expect(r!.h).toBe(40);
  });

  it('returns null when bbox is null', () => {
    expect(scaleBboxToBake(null, 100, 100, 200, 200)).toBeNull();
  });

  it('guarantees at least 1px width and height', () => {
    const r = scaleBboxToBake([0, 0, 0, 0], 100, 100, 100, 100);
    expect(r!.w).toBeGreaterThanOrEqual(1);
    expect(r!.h).toBeGreaterThanOrEqual(1);
  });
});
