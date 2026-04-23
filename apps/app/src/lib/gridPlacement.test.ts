import { describe, it, expect } from 'vitest';
import { placeGrid } from './gridPlacement';

const mk = (w: number, h: number) => ({ width: w, height: h });

describe('placeGrid', () => {
  it('single item: centered on anchor (like current single-drop behavior)', () => {
    const items = [mk(200, 100)];
    const out = placeGrid(items, { worldX: 500, worldY: 500 }, 32);
    expect(out).toEqual([
      { x: 500 - 100, y: 500 - 50, width: 200, height: 100 },
    ]);
  });

  it('four items: 2x2 grid with cluster centered on anchor', () => {
    const items = [mk(100, 100), mk(100, 100), mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 10);
    // cell = 110x110, 2 cols, 2 rows, cluster = 220x220, centered on (0,0)
    // first cell top-left at (-110, -110)
    expect(out.map((r) => ({ x: r.x, y: r.y }))).toEqual([
      { x: -110, y: -110 },
      { x: 0, y: -110 },
      { x: -110, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('ten items: 4x3 grid (ceil(sqrt(10))=4 cols, ceil(10/4)=3 rows)', () => {
    const items = Array.from({ length: 10 }, () => mk(50, 50));
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 0);
    // 4 cols, 3 rows, each cell 50x50, cluster 200x150
    expect(out).toHaveLength(10);
    // row 0 cols 0..3 y = -75
    // row 2 has 2 items at cols 0..1 (indexes 8, 9)
    expect(out[0]!.x).toBe(-100);
    expect(out[0]!.y).toBe(-75);
    expect(out[9]!.x).toBe(-50);
    expect(out[9]!.y).toBe(25);
  });

  it('uses max width/height across items for uniform cell size', () => {
    const items = [mk(200, 100), mk(50, 300), mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 0);
    // cell = 200x300, 2x2, cluster = 400x600
    // item 0 at (-200, -300), item 1 at (0, -300), item 2 at (-200, 0), item 3 at (0, 0)
    expect(out[0]).toMatchObject({ x: -200, y: -300, width: 200, height: 100 });
    expect(out[1]).toMatchObject({ x: 0, y: -300, width: 50, height: 300 });
    expect(out[2]).toMatchObject({ x: -200, y: 0, width: 100, height: 100 });
  });

  it('empty input returns empty', () => {
    expect(placeGrid([], { worldX: 0, worldY: 0 }, 32)).toEqual([]);
  });
});
