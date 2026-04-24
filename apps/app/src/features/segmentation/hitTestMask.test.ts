import { describe, it, expect } from 'vitest';
import { hitTestAtPointer, pointInMask } from './hitTestMask';
import type { HitMask } from './types';

const square = (
  x: number,
  y: number,
  size: number,
  tag: string,
  idx: number,
): HitMask => ({
  tag,
  maskIndex: idx,
  rings: [
    [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  ],
  bbox: { x, y, w: size, h: size },
});

describe('pointInMask', () => {
  it('returns true for a point inside a single ring', () => {
    const rings = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    expect(pointInMask(5, 5, rings)).toBe(true);
  });

  it('returns false for a point outside a ring', () => {
    const rings = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    expect(pointInMask(20, 5, rings)).toBe(false);
  });

  it('treats a point in a donut hole as outside (even-odd)', () => {
    const rings = [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ],
    ];
    expect(pointInMask(2, 2, rings)).toBe(true);
    expect(pointInMask(10, 10, rings)).toBe(false);
  });

  it('returns false for rings with fewer than 3 points', () => {
    expect(pointInMask(5, 5, [[{ x: 0, y: 0 }, { x: 10, y: 10 }]])).toBe(false);
  });
});

describe('hitTestAtPointer', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it('returns the topmost mask at a point', () => {
    const under = square(0, 0, 50, 'under', 0);
    const over = square(20, 20, 50, 'over', 0);
    const hit = hitTestAtPointer(
      { pointerX: 30, pointerY: 30 },
      rect,
      [under, over],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'over', maskIndex: 0 });
  });

  it('returns the under mask when over is absent at that point', () => {
    const under = square(0, 0, 50, 'under', 0);
    const over = square(60, 60, 20, 'over', 0);
    const hit = hitTestAtPointer(
      { pointerX: 10, pointerY: 10 },
      rect,
      [under, over],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'under', maskIndex: 0 });
  });

  it('returns null when the pointer is outside every mask', () => {
    const m = square(0, 0, 10, 'cat', 0);
    const hit = hitTestAtPointer(
      { pointerX: 50, pointerY: 50 },
      rect,
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toBeNull();
  });

  it('returns null when the pointer is outside the canvas rect', () => {
    const m = square(0, 0, 100, 'cat', 0);
    expect(
      hitTestAtPointer(
        { pointerX: -5, pointerY: 5 },
        rect,
        [m],
        'img1',
        100,
        100,
      ),
    ).toBeNull();
    expect(
      hitTestAtPointer(
        { pointerX: 105, pointerY: 5 },
        rect,
        [m],
        'img1',
        100,
        100,
      ),
    ).toBeNull();
  });

  it('maps pointer coords to bake-pixel space via the rect ratio', () => {
    const m = square(0, 0, 10, 'cat', 0);
    const hit = hitTestAtPointer(
      { pointerX: 10, pointerY: 10 },
      { left: 0, top: 0, width: 200, height: 200 },
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'cat', maskIndex: 0 });
  });

  it('handles non-zero rect origin (pan offset)', () => {
    const m = square(0, 0, 50, 'cat', 0);
    const hit = hitTestAtPointer(
      { pointerX: 205, pointerY: 305 },
      { left: 200, top: 300, width: 100, height: 100 },
      [m],
      'img1',
      100,
      100,
    );
    expect(hit).toEqual({ imageId: 'img1', tag: 'cat', maskIndex: 0 });
  });

  it('returns null for zero-sized rects', () => {
    const m = square(0, 0, 50, 'cat', 0);
    expect(
      hitTestAtPointer(
        { pointerX: 5, pointerY: 5 },
        { left: 0, top: 0, width: 0, height: 100 },
        [m],
        'img1',
        100,
        100,
      ),
    ).toBeNull();
  });
});
