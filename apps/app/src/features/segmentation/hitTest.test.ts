import { describe, it, expect } from 'vitest';
import { hitTestAtPointer } from './hitTest';

describe('hitTestAtPointer', () => {
  it('returns the id at the mapped pixel', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;            // (0,0)
    idMap[1] = 7;            // (1,0)
    idMap[4 * 4 - 1] = 9;    // (3,3)
    // Canvas rect is 100x100 at screen origin; bake is 4x4.
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 5, pointerY: 5 }, rect, idMap, 4, 4)).toBe(5);
    expect(hitTestAtPointer({ pointerX: 30, pointerY: 5 }, rect, idMap, 4, 4)).toBe(7);
    expect(hitTestAtPointer({ pointerX: 95, pointerY: 95 }, rect, idMap, 4, 4)).toBe(9);
  });

  it('returns 0 for empty pixels', () => {
    const idMap = new Uint16Array(4 * 4);
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 50, pointerY: 50 }, rect, idMap, 4, 4)).toBe(0);
  });

  it('returns 0 for pointers outside the canvas rect', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;
    const rect = { left: 100, top: 100, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 50, pointerY: 50 }, rect, idMap, 4, 4)).toBe(0);
    expect(hitTestAtPointer({ pointerX: 250, pointerY: 150 }, rect, idMap, 4, 4)).toBe(0);
  });

  it('handles non-zero rect origin (pan offset)', () => {
    const idMap = new Uint16Array(4 * 4);
    idMap[0] = 5;
    const rect = { left: 200, top: 300, width: 100, height: 100 };
    expect(hitTestAtPointer({ pointerX: 205, pointerY: 305 }, rect, idMap, 4, 4)).toBe(5);
  });
});
