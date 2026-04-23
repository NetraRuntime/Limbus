import { describe, it, expect } from 'vitest';
import { capDims } from './dims';

describe('capDims', () => {
  it('returns the input dims when below cap', () => {
    expect(capDims(800, 600, 2048)).toEqual({ w: 800, h: 600 });
  });

  it('scales the longest side down to cap, preserving aspect ratio', () => {
    const { w, h } = capDims(4096, 2048, 2048);
    expect(w).toBe(2048);
    expect(h).toBe(1024);
  });

  it('scales height-dominant images', () => {
    const { w, h } = capDims(1024, 4096, 2048);
    expect(h).toBe(2048);
    expect(w).toBe(512);
  });

  it('rounds to integer pixels', () => {
    const { w, h } = capDims(4097, 2048, 2048);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('returns at least 1 pixel on extreme aspect ratios', () => {
    const { w, h } = capDims(10000, 1, 2048);
    expect(w).toBe(2048);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});
