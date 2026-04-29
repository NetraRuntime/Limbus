export type Point = { x: number; y: number };

type Adj = Map<number, [number, number]>;

export function extractContours(
  sample: (x: number, y: number) => number,
  threshold: number,
  width: number,
  height: number,
): Point[][] {
  const stride = width + 4;
  const shift = 2;
  const vBase = stride * (height + 4);
  const horizKey = (i: number, j: number): number =>
    (j + shift) * stride + (i + shift);
  const vertKey = (i: number, j: number): number =>
    vBase + (j + shift) * stride + (i + shift);

  const adj: Adj = new Map();
  const points = new Map<number, Point>();

  function addSegment(ka: number, pa: Point, kb: number, pb: Point) {
    if (!points.has(ka)) points.set(ka, pa);
    if (!points.has(kb)) points.set(kb, pb);
    const ea = adj.get(ka);
    if (!ea) adj.set(ka, [kb, -1]);
    else if (ea[1] === -1) ea[1] = kb;
    const eb = adj.get(kb);
    if (!eb) adj.set(kb, [ka, -1]);
    else if (eb[1] === -1) eb[1] = ka;
  }

  function lerp(a: number, b: number): number {
    const denom = b - a;
    if (denom === 0) return 0.5;
    const t = (threshold - a) / denom;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // 1-cell virtual outside border so grid-edge regions close cleanly.
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

      const kT = horizKey(i, j);
      const kB = horizKey(i, j + 1);
      const kL = vertKey(i, j);
      const kR = vertKey(i + 1, j);

      const T: Point = { x: i + lerp(tlV, trV), y: j };
      const R: Point = { x: i + 1, y: j + lerp(trV, brV) };
      const B: Point = { x: i + lerp(blV, brV), y: j + 1 };
      const L: Point = { x: i, y: j + lerp(tlV, blV) };

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
