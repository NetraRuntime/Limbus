import type { ComposedBake, ComposeInput } from './types';
import { capDims } from './dims';
import { scaleBboxToBake } from './bbox';
import { strokeWidthFor } from './stroke';

const DEFAULT_MAX_SIDE = 2048;
// Alpha threshold for "inside" a mask. SAM3 emits soft-alpha PNGs for
// CSS rendering; we binarize here so the baked overlay has crisp edges
// (no anti-aliased gradient from translucent to opaque).
const ALPHA_THRESHOLD = 128;
// Baked fill opacity. Matches the 0.5 globalAlpha the old DOM overlay
// used (`.segment-mask { opacity: 0.5 }`). Baked once, so it can't be
// re-tuned at render time — if the UI wants to change overlay opacity,
// the bake signature should include this value.
const FILL_ALPHA = 128;

type ReadableBitmap = ImageBitmap & { width: number; height: number };

async function getMaskBitmap(
  cache: ComposeInput['decodeCache'],
  b64: string,
): Promise<ReadableBitmap> {
  const bmp = await cache.get(b64);
  return bmp as ReadableBitmap;
}

/**
 * Read the pixels of an ImageBitmap into an RGBA `Uint8ClampedArray` at
 * its native size. Used to sample mask alpha and rasterize it into the
 * bake without any browser smoothing.
 */
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

function parseColor(input: string): { r: number; g: number; b: number } {
  const s = input.trim();
  if (s.startsWith('#')) {
    const body = s.slice(1);
    if (body.length === 3) {
      return {
        r: parseInt(body[0]! + body[0]!, 16),
        g: parseInt(body[1]! + body[1]!, 16),
        b: parseInt(body[2]! + body[2]!, 16),
      };
    }
    if (body.length >= 6) {
      return {
        r: parseInt(body.slice(0, 2), 16),
        g: parseInt(body.slice(2, 4), 16),
        b: parseInt(body.slice(4, 6), 16),
      };
    }
  }
  const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    return { r: parseInt(m[1]!, 10), g: parseInt(m[2]!, 10), b: parseInt(m[3]!, 10) };
  }
  // Fallback to magenta so parsing bugs are visible.
  return { r: 255, g: 0, b: 255 };
}

/**
 * Compose all ready masks for a single image into a single ImageBitmap +
 * id-map. Pixels are written in one fused loop per mask:
 *
 *   - Nearest-neighbour sample of the mask's native-resolution alpha
 *   - Binarize (alpha > threshold) for crisp edges
 *   - Override the bake pixel with accent color at FILL_ALPHA
 *   - Write the mask's id into the parallel idMap
 *
 * Layering: later masks overwrite earlier ones at overlapping pixels,
 * so the topmost mask wins both the color and the hit-test.
 *
 * Bbox strokes are added on a final pass with smoothing off.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');
  vctx.imageSmoothingEnabled = false;

  const idMap = new Uint16Array(w * h);
  const idToMask: Array<{ tag: string; maskIndex: number }> = [];
  const lineWidth = strokeWidthFor(w, h);

  // Shared RGBA buffer populated across all masks; pushed to the canvas
  // once at the end via a single putImageData.
  const bakeRgba = new Uint8ClampedArray(w * h * 4);

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const id = i + 1;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);
    const { r: rr, g: gg, b: bb } = parseColor(m.accent);

    const sx = mw / w;
    const sy = mh / h;
    for (let y = 0; y < h; y++) {
      const my = Math.min(mh - 1, Math.floor(y * sy));
      const rowB = y * w;
      const rowM = my * mw;
      for (let x = 0; x < w; x++) {
        const mx = Math.min(mw - 1, Math.floor(x * sx));
        const mi = (rowM + mx) * 4;
        // Mask luminance/alpha: SAM3 emits alpha-mask PNGs where the
        // mask sits in the alpha channel. Use max of rgb+a for
        // robustness against encoders that populate luminance instead.
        const rVal = rgba[mi] ?? 0;
        const gVal = rgba[mi + 1] ?? 0;
        const bVal = rgba[mi + 2] ?? 0;
        const aVal = rgba[mi + 3] ?? 0;
        const v = Math.max(rVal, gVal, bVal, aVal);
        if (v > ALPHA_THRESHOLD) {
          const bi = (rowB + x) * 4;
          bakeRgba[bi] = rr;
          bakeRgba[bi + 1] = gg;
          bakeRgba[bi + 2] = bb;
          bakeRgba[bi + 3] = FILL_ALPHA;
          idMap[rowB + x] = id;
        }
      }
    }
    idToMask.push({ tag: m.tag, maskIndex: m.maskIndex });
  }

  // Single write of the combined mask fills onto the visual canvas.
  vctx.putImageData(new ImageData(bakeRgba, w, h), 0, 0);

  // Bbox strokes over the fills — drawn last so they sit on top.
  for (const m of input.masks) {
    const rect = scaleBboxToBake(m.bbox, m.maskW, m.maskH, w, h);
    if (!rect) continue;
    vctx.save();
    vctx.strokeStyle = m.accent;
    vctx.lineWidth = lineWidth;
    vctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    vctx.restore();
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, idMap, idToMask, width: w, height: h };
}
