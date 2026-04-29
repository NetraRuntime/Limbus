import type { ComposedBake, ComposeInput, HitMask } from './types';
import { capDims } from './dims';
import { strokeWidthFor } from './stroke';
import { extractContours, ringsToPath, smoothChaikin, type Point } from './contours';

const DEFAULT_MAX_SIDE = 4096;
const ALPHA_THRESHOLD = 128;
const FILL_ALPHA = 0.3;
const SMOOTH_ITERATIONS = 2;

type ReadableBitmap = ImageBitmap & { width: number; height: number };

async function getMaskBitmap(
  cache: ComposeInput['decodeCache'],
  b64: string,
): Promise<ReadableBitmap> {
  const bmp = await cache.get(b64);
  return bmp as ReadableBitmap;
}

function readBitmapPixels(bmp: ReadableBitmap): {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const off = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { rgba: data.data, w: bmp.width, h: bmp.height };
}

function ringsBbox(
  rings: ReadonlyArray<ReadonlyArray<Point>>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const hitMasks: HitMask[] = [];
  const edgeLineWidth = Math.max(1, Math.round(strokeWidthFor(w, h) * 0.75));

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);

    const sample = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= mw || y >= mh) return 0;
      const i4 = (y * mw + x) * 4;
      const r = rgba[i4] ?? 0;
      const g = rgba[i4 + 1] ?? 0;
      const b = rgba[i4 + 2] ?? 0;
      const a = rgba[i4 + 3] ?? 0;
      return Math.max(r, g, b, a);
    };

    const rawRings = extractContours(sample, ALPHA_THRESHOLD, mw, mh);
    if (rawRings.length === 0) {
      hitMasks.push({
        tag: m.tag,
        maskIndex: m.maskIndex,
        entryId: m.entryId,
        rings: [],
        bbox: { x: 0, y: 0, w: 0, h: 0 },
      });
      continue;
    }
    const smoothed = rawRings.map((r) => smoothChaikin(r, SMOOTH_ITERATIONS));
    const scaleX = w / mw;
    const scaleY = h / mh;
    const scaled: Point[][] = smoothed.map((ring) =>
      ring.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
    );
    const path = ringsToPath(scaled);

    vctx.save();
    vctx.globalAlpha = FILL_ALPHA;
    vctx.fillStyle = m.accent;
    vctx.fill(path, 'evenodd');
    vctx.globalAlpha = 1;
    vctx.lineWidth = edgeLineWidth;
    vctx.strokeStyle = '#ffffff';
    vctx.lineJoin = 'round';
    vctx.lineCap = 'round';
    vctx.stroke(path);
    vctx.restore();

    hitMasks.push({
      tag: m.tag,
      maskIndex: m.maskIndex,
      entryId: m.entryId,
      rings: scaled,
      bbox: ringsBbox(scaled),
    });
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, hitMasks, width: w, height: h };
}
