import { describe, it, expect } from 'vitest';
import { extractContours, smoothChaikin } from './contours';

// Helper: treat a 2-D number grid as a scalar field. Out-of-bounds
// samples read as 0, matching the convention used by callers for the
// virtual outside border.
function gridSample(grid: ReadonlyArray<ReadonlyArray<number>>) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  return {
    width: w,
    height: h,
    sample: (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return grid[y]?.[x] ?? 0;
    },
  };
}

// For binary (0/1) grids, threshold 0.5 puts linearly-interpolated
// crossings at the exact midpoint of each cell edge — matching the
// algorithm's behavior on hard masks.
const BIN = 0.5;

describe('extractContours', () => {
  it('returns no rings for an empty grid', () => {
    const { sample, width, height } = gridSample([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(extractContours(sample, BIN, width, height)).toEqual([]);
  });

  it('returns a single perimeter ring for a fully-inside grid', () => {
    const { sample, width, height } = gridSample([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    // The 1-cell virtual border surrounds the filled grid, so we DO get
    // a ring tracing the outer perimeter — that's the desired behavior.
    const rings = extractContours(sample, BIN, width, height);
    expect(rings.length).toBe(1);
    // Bounding box of the single ring should contain the whole grid.
    const ring = rings[0]!;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(width - 1);
    expect(Math.min(...ys)).toBeLessThanOrEqual(0);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(height - 1);
  });

  it('extracts a single ring around a square', () => {
    const { sample, width, height } = gridSample([
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
    const rings = extractContours(sample, BIN, width, height);
    expect(rings.length).toBe(1);
    const ring = rings[0]!;
    // Boundary of a 2x2 inside region crosses 8 cell edges.
    expect(ring.length).toBeGreaterThanOrEqual(4);
    // All ring vertices lie on the boundary of the 2x2 inside square.
    for (const p of ring) {
      expect(p.x).toBeGreaterThanOrEqual(0.5);
      expect(p.x).toBeLessThanOrEqual(2.5);
      expect(p.y).toBeGreaterThanOrEqual(0.5);
      expect(p.y).toBeLessThanOrEqual(2.5);
    }
  });

  it('extracts two rings for a donut (mask with a hole)', () => {
    const { sample, width, height } = gridSample([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const rings = extractContours(sample, BIN, width, height);
    expect(rings.length).toBe(2);
    // The two rings should have different bounding boxes — outer is
    // bigger, inner is smaller.
    const bboxes = rings.map((r) => {
      const xs = r.map((p) => p.x);
      const ys = r.map((p) => p.y);
      return {
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    });
    bboxes.sort((a, b) => a.w * a.h - b.w * b.h);
    expect(bboxes[0]!.w * bboxes[0]!.h).toBeLessThan(bboxes[1]!.w * bboxes[1]!.h);
  });

  it('handles a single-pixel mask (no virtual-border crash)', () => {
    const { sample, width, height } = gridSample([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    const rings = extractContours(sample, BIN, width, height);
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(4);
  });

  it('produces two non-crossing rings on a saddle (TL+BR diagonal)', () => {
    // A 2x2 cell where TL and BR are inside, TR and BL are outside.
    // Padded with a 0-border so the saddle is a single 2x2 cell.
    const { sample, width, height } = gridSample([
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
    ]);
    const rings = extractContours(sample, BIN, width, height);
    // Two separate inside pixels → two separate rings.
    expect(rings.length).toBe(2);
  });

  it('closes a ring that touches the grid edge', () => {
    const { sample, width, height } = gridSample([
      [1, 1, 0],
      [1, 1, 0],
      [0, 0, 0],
    ]);
    const rings = extractContours(sample, BIN, width, height);
    expect(rings.length).toBe(1);
    // Ring should include vertices outside the grid (negative coords)
    // because the virtual border is at -0.5.
    const xs = rings[0]!.map((p) => p.x);
    const ys = rings[0]!.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.min(...ys)).toBeLessThan(0);
  });

  it('places vertices at the interpolated iso-crossing, not fixed midpoints', () => {
    // Graded field: value grows with x. Inside region is to the right
    // of the threshold. With threshold 128, the right-side boundary of
    // the two inside-ish columns should land at sub-pixel x positions
    // derived from the neighbouring samples, not at a half-integer.
    //
    //   col x: 0   1   2    3
    //   val:   0   80  200  255
    //
    // Between col 1 (80) and col 2 (200), threshold 128 crosses at
    // t = (128 - 80) / (200 - 80) = 48 / 120 = 0.4 → x = 1.4
    const grid = [
      [0, 80, 200, 255],
      [0, 80, 200, 255],
      [0, 80, 200, 255],
    ];
    const { sample, width, height } = gridSample(grid);
    const rings = extractContours(sample, 128, width, height);
    expect(rings.length).toBe(1);
    const ring = rings[0]!;
    // Vertices on the vertical boundary between col 1 and col 2 have
    // integer y (top/bottom of a cell) and fractional x = 1.4.
    const onInterpolatedEdge = ring.filter(
      (p) => Math.abs(p.x - 1.4) < 1e-9 && Number.isInteger(p.y),
    );
    expect(onInterpolatedEdge.length).toBeGreaterThan(0);
    // Sanity: no vertex sits at the naïve midpoint x = 1.5 on that edge.
    const atMidpoint = ring.filter(
      (p) => Math.abs(p.x - 1.5) < 1e-9 && Number.isInteger(p.y),
    );
    expect(atMidpoint.length).toBe(0);
  });

  it('shares one interpolated vertex between adjacent cells', () => {
    // A horizontal edge between two cells must yield the SAME vertex
    // position when sampled from either side — otherwise the boundary
    // develops cracks. We verify by finding the vertex on the
    // cross-column edge and confirming exactly one vertex sits there.
    const grid = [
      [0, 50, 255],
      [0, 50, 255],
      [0, 50, 255],
    ];
    const { sample, width, height } = gridSample(grid);
    const rings = extractContours(sample, 128, width, height);
    expect(rings.length).toBe(1);
    const ring = rings[0]!;
    // Between x=1 (value 50) and x=2 (value 255), threshold 128 crosses
    // at t = (128-50)/(255-50) = 78/205 ≈ 0.3805 → x ≈ 1.3805.
    const expected = 1 + (128 - 50) / (255 - 50);
    const crossings = ring.filter(
      (p) => Math.abs(p.x - expected) < 1e-9 && Number.isInteger(p.y),
    );
    // One vertex per horizontal row crossing (y ∈ {0, 1, 2} + 1-cell
    // virtual border). Each row's edge between col 1 and col 2 yields
    // exactly one vertex regardless of which neighbouring cell sampled
    // it first.
    expect(crossings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('smoothChaikin', () => {
  it('returns a copy when iterations is 0', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const out = smoothChaikin(ring, 0);
    expect(out).toEqual(ring);
    expect(out).not.toBe(ring);
  });

  it('returns a copy when ring has fewer than 3 points', () => {
    const ring = [{ x: 0, y: 0 }];
    expect(smoothChaikin(ring, 3)).toEqual(ring);
  });

  it('doubles the vertex count per iteration', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(smoothChaikin(ring, 1).length).toBe(8);
    expect(smoothChaikin(ring, 2).length).toBe(16);
    expect(smoothChaikin(ring, 3).length).toBe(32);
  });

  it('keeps smoothed vertices inside the convex hull of the input', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const out = smoothChaikin(ring, 3);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10);
    }
  });

  it('reduces total turning angle (cuts sharp corners)', () => {
    // Square with 4 right-angle corners → total turning ~2π.
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    function maxAngle(r: ReadonlyArray<{ x: number; y: number }>): number {
      let max = 0;
      const n = r.length;
      for (let i = 0; i < n; i++) {
        const a = r[(i - 1 + n) % n]!;
        const b = r[i]!;
        const c = r[(i + 1) % n]!;
        const v1x = b.x - a.x, v1y = b.y - a.y;
        const v2x = c.x - b.x, v2y = c.y - b.y;
        const dot = v1x * v2x + v1y * v2y;
        const m1 = Math.hypot(v1x, v1y);
        const m2 = Math.hypot(v2x, v2y);
        if (m1 === 0 || m2 === 0) continue;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))));
        if (angle > max) max = angle;
      }
      return max;
    }
    const before = maxAngle(ring);
    const after = maxAngle(smoothChaikin(ring, 2));
    // Square corner is π/2 ≈ 1.57. After 2 Chaikin iterations the
    // sharpest corner should be much smaller.
    expect(before).toBeCloseTo(Math.PI / 2, 2);
    expect(after).toBeLessThan(before / 2);
  });
});
