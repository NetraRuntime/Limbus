/**
 * Marching squares contour extraction + Chaikin polygon smoothing.
 *
 * `extractContours` returns one or more closed polygon rings tracing the
 * iso-line of a scalar field at a given threshold. The field is sampled at
 * integer grid corners via the `sample` callback; vertex positions along
 * each cell edge are computed by **linear interpolation** of the
 * corner values (classical marching squares with iso-line interpolation),
 * so soft/anti-aliased input produces sub-pixel-accurate contours instead
 * of the half-integer staircase that midpoint marching squares yields.
 *
 * A 1-cell virtual border of "outside" samples is added (iteration begins
 * at -1) so regions touching the grid edge close cleanly. Samples outside
 * [0, width) × [0, height) should return a value below the threshold —
 * callers typically return 0.
 *
 * Saddle cells (TL+BR or TR+BL inside, the other diagonal outside) are
 * resolved as two disconnected inside corners — each corner is treated
 * like a code-1 / code-2 / code-4 / code-8 cell. This produces two
 * non-crossing segments per saddle.
 *
 * `smoothChaikin` performs Chaikin's corner-cutting subdivision on a
 * closed ring. Each iteration roughly doubles vertex count and cuts
 * angular corners; combined with interpolated marching squares, 2
 * iterations round the remaining cell-to-cell joints into a visually
 * smooth curve.
 */

export type Point = { x: number; y: number };

type Adj = Map<number, [number, number]>;

/**
 * Extract closed boundary rings of the region where `sample >= threshold`.
 * Returns an empty array if the inside region is empty or covers the
 * whole (padded) grid.
 */
export function extractContours(
  sample: (x: number, y: number) => number,
  threshold: number,
  width: number,
  height: number,
): Point[][] {
  // Edge-index stride. Edges are indexed by the integer grid corner they
  // start from, so i ∈ [-1, width] and j ∈ [-1, height]; shift by +2 to
  // keep packed keys non-negative.
  const stride = width + 4;
  const shift = 2;
  // Two edge kinds (horizontal / vertical) packed into a single integer
  // key. Vertical keys live above the horizontal range.
  const vBase = stride * (height + 4);
  const horizKey = (i: number, j: number): number =>
    (j + shift) * stride + (i + shift);
  const vertKey = (i: number, j: number): number =>
    vBase + (j + shift) * stride + (i + shift);

  // Adjacency: each contour vertex has exactly two neighbours (one
  // segment in, one segment out). Slot 1 uses -1 as "unset".
  const adj: Adj = new Map();
  const points = new Map<number, Point>();

  function addSegment(ka: number, pa: Point, kb: number, pb: Point) {
    if (!points.has(ka)) points.set(ka, pa);
    if (!points.has(kb)) points.set(kb, pb);
    const ea = adj.get(ka);
    if (!ea) adj.set(ka, [kb, -1]);
    else if (ea[1] === -1) ea[1] = kb;
    // Degree > 2 should never happen for a well-formed boundary; if it
    // does (degenerate saddle), drop the extra.
    const eb = adj.get(kb);
    if (!eb) adj.set(kb, [ka, -1]);
    else if (eb[1] === -1) eb[1] = ka;
  }

  // Linear interpolation along a cell edge. `a` and `b` are the scalar
  // values at the edge endpoints; returns the fractional position in
  // [0, 1] where the field equals `threshold`. Degenerate (a === b)
  // falls back to midpoint.
  function lerp(a: number, b: number): number {
    const denom = b - a;
    if (denom === 0) return 0.5;
    const t = (threshold - a) / denom;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // Iterate cells with a 1-cell virtual outside border so boundaries at
  // the grid edge close cleanly.
  for (let j = -1; j < height; j++) {
    for (let i = -1; i < width; i++) {
      const tlV = sample(i, j);
      const trV = sample(i + 1, j);
      const brV = sample(i + 1, j + 1);
      const blV = sample(i, j + 1);
      const tl = tlV > threshold ? 1 : 0;
      const tr = trV > threshold ? 1 : 0;
      const br = brV > threshold ? 1 : 0;
      const bl = blV > threshold ? 1 : 0;
      const code = tl | (tr << 1) | (br << 2) | (bl << 3);
      if (code === 0 || code === 15) continue;

      // Edge keys: shared across cells. `horizKey(i, j)` names the
      // horizontal edge from corner (i, j) to corner (i+1, j), which is
      // simultaneously the top edge of cell (i, j) and the bottom edge
      // of cell (i, j-1). `vertKey(i, j)` names the vertical edge from
      // corner (i, j) to corner (i, j+1), i.e. left of cell (i, j) and
      // right of cell (i-1, j).
      const kT = horizKey(i, j);
      const kB = horizKey(i, j + 1);
      const kL = vertKey(i, j);
      const kR = vertKey(i + 1, j);

      // Interpolated crossing positions along the four cell edges.
      const T: Point = { x: i + lerp(tlV, trV), y: j };
      const R: Point = { x: i + 1, y: j + lerp(trV, brV) };
      const B: Point = { x: i + lerp(blV, brV), y: j + 1 };
      const L: Point = { x: i, y: j + lerp(tlV, blV) };

      // Orientation: walking direction has "inside" on the left
      // (counter-clockwise around an inside region in screen space,
      // i.e. y pointing down).
      switch (code) {
        case 1:
          addSegment(kL, L, kT, T);
          break;
        case 2:
          addSegment(kT, T, kR, R);
          break;
        case 3:
          addSegment(kL, L, kR, R);
          break;
        case 4:
          addSegment(kR, R, kB, B);
          break;
        case 5:
          addSegment(kL, L, kT, T);
          addSegment(kR, R, kB, B);
          break;
        case 6:
          addSegment(kT, T, kB, B);
          break;
        case 7:
          addSegment(kL, L, kB, B);
          break;
        case 8:
          addSegment(kB, B, kL, L);
          break;
        case 9:
          addSegment(kB, B, kT, T);
          break;
        case 10:
          addSegment(kT, T, kR, R);
          addSegment(kB, B, kL, L);
          break;
        case 11:
          addSegment(kB, B, kR, R);
          break;
        case 12:
          addSegment(kR, R, kL, L);
          break;
        case 13:
          addSegment(kR, R, kT, T);
          break;
        case 14:
          addSegment(kT, T, kL, L);
          break;
      }
    }
  }

  // Walk the adjacency graph to chain segments into closed rings.
  const visited = new Set<number>();
  const rings: Point[][] = [];

  for (const startKey of adj.keys()) {
    if (visited.has(startKey)) continue;
    const ring: Point[] = [];
    let prev = -1;
    let cur = startKey;
    const cap = adj.size + 1;
    for (let step = 0; step < cap; step++) {
      if (visited.has(cur)) break;
      visited.add(cur);
      const pt = points.get(cur);
      if (!pt) break;
      ring.push(pt);
      const nbrs = adj.get(cur);
      if (!nbrs) break;
      const [n0, n1] = nbrs;
      const next = n0 !== prev && n0 !== -1 ? n0 : n1;
      if (next === -1) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}

/**
 * Chaikin's corner-cutting subdivision on a closed ring. Each iteration
 * replaces every vertex with two new vertices at 1/4 and 3/4 along each
 * edge, cutting off corners. After ~2 iterations the residual cell-to-
 * cell joints from marching squares round into a smooth curve.
 *
 * Returns a copy unchanged if the ring has fewer than 3 points or
 * `iterations` is 0.
 */
export function smoothChaikin(
  ring: ReadonlyArray<Point>,
  iterations: number,
): Point[] {
  if (ring.length < 3 || iterations <= 0) return ring.slice();
  let pts: Point[] = ring.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const n = pts.length;
    const next: Point[] = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % n]!;
      next[i * 2] = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 };
      next[i * 2 + 1] = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 };
    }
    pts = next;
  }
  return pts;
}

/**
 * Build a `Path2D` from a list of rings, each appended as a closed
 * sub-path. Optionally applies a per-axis scale + offset so contours
 * extracted in mask-pixel space can render directly into bake-pixel
 * space.
 */
export function ringsToPath(
  rings: ReadonlyArray<ReadonlyArray<Point>>,
  scaleX = 1,
  scaleY = 1,
  offsetX = 0,
  offsetY = 0,
): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    const p0 = ring[0]!;
    path.moveTo(p0.x * scaleX + offsetX, p0.y * scaleY + offsetY);
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i]!;
      path.lineTo(p.x * scaleX + offsetX, p.y * scaleY + offsetY);
    }
    path.closePath();
  }
  return path;
}
