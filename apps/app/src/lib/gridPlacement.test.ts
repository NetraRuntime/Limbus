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
    // cluster = 2*100 + 1*10 = 210 (content + internal gap, no trailing gap).
    // origin = -105. cell stride = 110.
    expect(out.map((r) => ({ x: r.x, y: r.y }))).toEqual([
      { x: -105, y: -105 },
      { x: 5, y: -105 },
      { x: -105, y: 5 },
      { x: 5, y: 5 },
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

  it('two items: 2x1 grid', () => {
    const items = [mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 20);
    // cols=2, rows=1. cluster = 2*100 + 1*20 = 220. origin = -110.
    expect(out.map((r) => ({ x: r.x, y: r.y }))).toEqual([
      { x: -110, y: -50 },
      { x: 10, y: -50 },
    ]);
  });

  it('three items: 2x2 grid with trailing empty cell', () => {
    const items = [mk(100, 100), mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 0);
    // cols=ceil(sqrt(3))=2, rows=ceil(3/2)=2. cluster = 200x200. origin = -100,-100.
    expect(out.map((r) => ({ x: r.x, y: r.y }))).toEqual([
      { x: -100, y: -100 },
      { x: 0, y: -100 },
      { x: -100, y: 0 },
    ]);
  });

  it('non-zero anchor and gap compose correctly', () => {
    const items = Array.from({ length: 9 }, () => mk(60, 40));
    const out = placeGrid(items, { worldX: 1000, worldY: 500 }, 20);
    // cols=3, rows=3, cellW=80, cellH=60. clusterW = 3*60 + 2*20 = 220. clusterH = 3*40 + 2*20 = 160.
    // originX = 1000 - 110 = 890. originY = 500 - 80 = 420.
    // item 0 at (890, 420). item 4 (col 1, row 1) at (890+80, 420+60) = (970, 480).
    expect(out[0]).toMatchObject({ x: 890, y: 420 });
    expect(out[4]).toMatchObject({ x: 970, y: 480 });
    expect(out[8]).toMatchObject({ x: 1050, y: 540 }); // col 2, row 2
  });
});
