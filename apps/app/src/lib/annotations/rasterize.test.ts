import { describe, it, expect } from 'vitest';
import { geometryToMaskBytes } from './rasterize';
import type { Geometry } from './types';

const FILL = [255, 255, 255, 255] as const;
const CLEAR = [0, 0, 0, 0] as const;

function pixelAt(bytes: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!];
}

describe('geometryToMaskBytes — bbox', () => {
  it('fills the bbox rectangle in image-space', () => {
    const g: Geometry = { kind: 'bbox' };
    const bytes = geometryToMaskBytes(g, { width: 10, height: 10 }, { bbox: [2, 3, 5, 6] });
    expect(bytes.length).toBe(10 * 10 * 4);
    expect(pixelAt(bytes, 10, 0, 0)).toEqual([...CLEAR]);
    expect(pixelAt(bytes, 10, 2, 3)).toEqual([...FILL]);
    expect(pixelAt(bytes, 10, 4, 5)).toEqual([...FILL]);
    expect(pixelAt(bytes, 10, 5, 6)).toEqual([...CLEAR]); // exclusive end
  });
});

describe('geometryToMaskBytes — polygon', () => {
  it('fills a square polygon', () => {
    const g: Geometry = { kind: 'polygon', rings: [[1, 1, 4, 1, 4, 4, 1, 4]] };
    const bytes = geometryToMaskBytes(g, { width: 6, height: 6 }, { bbox: [1, 1, 4, 4] });
    expect(pixelAt(bytes, 6, 2, 2)).toEqual([...FILL]);
    expect(pixelAt(bytes, 6, 0, 0)).toEqual([...CLEAR]);
    expect(pixelAt(bytes, 6, 5, 5)).toEqual([...CLEAR]);
  });
});

describe('geometryToMaskBytes — rle', () => {
  it('decodes column-major COCO RLE into the correct pixels', () => {
    // Size 4x4. Counts alternate starting with 0s: 0 zeros, 4 ones, 4 zeros, 8 ones.
    // Column-major: column 0 all 1s, column 1 all 0s, columns 2+3 all 1s.
    const g: Geometry = { kind: 'rle', counts: [0, 4, 4, 8], width: 4, height: 4 };
    const bytes = geometryToMaskBytes(g, { width: 4, height: 4 }, { bbox: [0, 0, 4, 4] });
    expect(pixelAt(bytes, 4, 0, 0)).toEqual([...FILL]); // col 0
    expect(pixelAt(bytes, 4, 1, 0)).toEqual([...CLEAR]); // col 1
    expect(pixelAt(bytes, 4, 2, 0)).toEqual([...FILL]); // col 2
    expect(pixelAt(bytes, 4, 3, 3)).toEqual([...FILL]); // col 3
  });
});
