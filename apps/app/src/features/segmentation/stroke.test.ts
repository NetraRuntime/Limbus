import { describe, it, expect } from 'vitest';
import { strokeWidthFor } from './stroke';

describe('strokeWidthFor', () => {
  it('returns at least 2 pixels for small bakes', () => {
    expect(strokeWidthFor(256, 256)).toBeGreaterThanOrEqual(2);
    expect(strokeWidthFor(800, 600)).toBeGreaterThanOrEqual(2);
  });

  it('scales up proportionally for large bakes', () => {
    const small = strokeWidthFor(800, 600);
    const big = strokeWidthFor(4096, 3000);
    expect(big).toBeGreaterThan(small);
  });

  it('uses the longer side as the reference', () => {
    expect(strokeWidthFor(2000, 500)).toBe(strokeWidthFor(500, 2000));
  });
});
