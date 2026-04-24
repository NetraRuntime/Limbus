import { describe, it, expect } from 'vitest';
import { buildIdMap } from './idMap';

// Build a maskW × maskH RGBA buffer with all pixels either fully inside
// (alpha 255, rgb 255) or fully outside (alpha 0, rgb 0).
function mkMask(maskW: number, maskH: number, inside: (x: number, y: number) => boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(maskW * maskH * 4);
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      const i = (y * maskW + x) * 4;
      const on = inside(x, y);
      out[i + 0] = on ? 255 : 0;
      out[i + 1] = on ? 255 : 0;
      out[i + 2] = on ? 255 : 0;
      out[i + 3] = on ? 255 : 0;
    }
  }
  return out;
}

describe('buildIdMap', () => {
  it('writes id at bake pixels where the rescaled mask is inside', () => {
    const idMap = new Uint16Array(4 * 4);
    const rgba = mkMask(4, 4, (x, y) => x < 2 && y < 2);
    buildIdMap(idMap, 4, 4, rgba, 4, 4, 7, 128);
    // Top-left 2x2 should be 7.
    expect(idMap[0]).toBe(7);
    expect(idMap[1]).toBe(7);
    expect(idMap[4]).toBe(7);
    expect(idMap[5]).toBe(7);
    // Elsewhere untouched.
    expect(idMap[2]).toBe(0);
    expect(idMap[15]).toBe(0);
  });

  it('rescales the mask to bake dims (nearest-neighbour)', () => {
    const idMap = new Uint16Array(8 * 8);
    // 2x2 mask: top-left inside, rest outside.
    const rgba = mkMask(2, 2, (x, y) => x === 0 && y === 0);
    buildIdMap(idMap, 8, 8, rgba, 2, 2, 3, 128);
    // The single "inside" mask pixel covers the top-left 4x4 of the bake.
    expect(idMap[0]).toBe(3);
    expect(idMap[3]).toBe(3);
    expect(idMap[3 * 8 + 3]).toBe(3);
    // Just outside that quadrant.
    expect(idMap[4]).toBe(0);
    expect(idMap[4 * 8]).toBe(0);
  });

  it('overwrites earlier ids for later masks (topmost wins)', () => {
    const idMap = new Uint16Array(4 * 4);
    const maskA = mkMask(4, 4, () => true);
    buildIdMap(idMap, 4, 4, maskA, 4, 4, 1, 128);
    const maskB = mkMask(4, 4, (x, y) => x < 2 && y < 2);
    buildIdMap(idMap, 4, 4, maskB, 4, 4, 2, 128);
    expect(idMap[0]).toBe(2); // overwritten by mask B
    expect(idMap[3]).toBe(1); // mask A still wins here
  });

  it('respects the luminance threshold', () => {
    const idMap = new Uint16Array(4 * 4);
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    // Pixel (0,0): just above threshold (129). Pixel (1,0): below (127).
    rgba[0] = 129; rgba[1] = 129; rgba[2] = 129; rgba[3] = 255;
    rgba[4] = 127; rgba[5] = 127; rgba[6] = 127; rgba[7] = 255;
    buildIdMap(idMap, 4, 4, rgba, 4, 4, 9, 128);
    expect(idMap[0]).toBe(9);
    expect(idMap[1]).toBe(0);
  });
});
