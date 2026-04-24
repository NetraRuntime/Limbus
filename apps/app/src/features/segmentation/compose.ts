import type { ComposedBake, ComposeInput } from './types';
import { capDims } from './dims';
import { strokeWidthFor } from './stroke';
import { extractContours, smoothChaikin } from './contours';

// Bake at up to source resolution. The visible canvas is CSS-stretched
// to the image's world rect, so capping below the source's native size
// forces a CSS upscale that reads as soft/blurry on hi-DPI displays.
// 4096 covers most photo-grade sources at 1:1; larger sources still
// get capped, but the upscale ratio at 100% zoom is smaller.
const DEFAULT_MAX_SIDE = 4096;
// Iso-threshold for "inside" a mask. SAM3 emits soft-alpha PNGs; the
// contour extractor reads the alpha as a continuous field and places
// vertices at the linearly-interpolated crossing of this threshold,
// which turns anti-aliased edge pixels into sub-pixel-accurate contours
// instead of a half-integer staircase.
const ALPHA_THRESHOLD = 128;
// Baked fill opacity. Kept low so the underlying image stays readable —
// the viewport-space bbox chrome carries most of the hue identity now,
// leaving the fill to hint at shape. Applied via `globalAlpha` so the
// accent string (which may be hsl/rgb/hex/named) is handed to the
// canvas as-is.
const FILL_ALPHA = 0.3;
// Chaikin smoothing iterations applied to each mask contour. 2 turns
// the marching-squares staircase into a visually smooth curve without
// drifting noticeably from the true boundary.
const SMOOTH_ITERATIONS = 2;

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
 * its native size. Used to sample mask alpha for both contour
 * extraction and id-map building.
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

/**
 * Build a `Path2D` from a list of rings, scaling/offsetting each
 * vertex from mask-pixel space into bake-pixel space.
 */
function ringsToPath(
  rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  scaleX: number,
  scaleY: number,
): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    const p0 = ring[0]!;
    path.moveTo(p0.x * scaleX, p0.y * scaleY);
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i]!;
      path.lineTo(p.x * scaleX, p.y * scaleY);
    }
    path.closePath();
  }
  return path;
}

/**
 * Compose all ready masks for a single image into one ImageBitmap +
 * id-map. For each mask:
 *
 *   - Binarize the mask alpha at ALPHA_THRESHOLD.
 *   - Extract closed boundary rings via marching squares (with a
 *     virtual outside border so masks at the grid edge close cleanly).
 *   - Smooth each ring with Chaikin's algorithm so the visible contour
 *     traces a curve instead of an axis-aligned staircase.
 *   - Fill the resulting Path2D with the accent color at FILL_ALPHA
 *     and stroke it in white for the edge ring.
 *   - Mark the mask's pixels in the parallel id-map at bake resolution.
 *
 * Layering: later masks paint over earlier ones, so the topmost mask
 * wins both the visual color and the hit-test.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');
  // Path fill/stroke anti-aliasing is on by default; image-smoothing
  // setting only affects drawImage, which we don't use here.

  const idMap = new Uint16Array(w * h);
  const idToMask: Array<{ tag: string; maskIndex: number }> = [];
  // Edge-ring thickness in bake pixels. Derived from the overall stroke
  // width so it tracks bake dimensions.
  const edgeLineWidth = Math.max(1, Math.round(strokeWidthFor(w, h) * 0.75));

  // Scratch canvas used to rasterize each mask's smoothed Path2D into
  // an alpha buffer, which is then thresholded to build the id-map.
  // Reused across masks (cleared per iteration) to avoid reallocating
  // a w*h*4 buffer per mask.
  const idScratch = new OffscreenCanvas(w, h);
  const sctx = idScratch.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('OffscreenCanvas 2d context unavailable');

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const id = i + 1;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);

    // Sample the mask as a continuous scalar field. SAM3 puts the mask
    // in the alpha channel for some encoders and in luminance for
    // others — `max(R, G, B, A)` is robust to both. Out-of-bounds
    // samples return 0 so the virtual outside border inside
    // `extractContours` always reads as outside the iso-region.
    const sample = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= mw || y >= mh) return 0;
      const i4 = (y * mw + x) * 4;
      const r = rgba[i4] ?? 0;
      const g = rgba[i4 + 1] ?? 0;
      const b = rgba[i4 + 2] ?? 0;
      const a = rgba[i4 + 3] ?? 0;
      return Math.max(r, g, b, a);
    };

    const rings = extractContours(sample, ALPHA_THRESHOLD, mw, mh);
    if (rings.length === 0) {
      idToMask.push({ tag: m.tag, maskIndex: m.maskIndex });
      continue;
    }
    const smoothed = rings.map((r) => smoothChaikin(r, SMOOTH_ITERATIONS));
    // Map mask-pixel coords to bake-pixel coords.
    const path = ringsToPath(smoothed, w / mw, h / mh);

    vctx.save();
    // Hand the accent string straight to the canvas — `colorForTag`
    // emits `hsl(...)` which the canvas parses natively. Opacity rides
    // on `globalAlpha` so we don't need to round-trip through a parser.
    vctx.globalAlpha = FILL_ALPHA;
    vctx.fillStyle = m.accent;
    // evenodd handles donut masks (outer ring + inner hole) without
    // depending on consistent ring winding.
    vctx.fill(path, 'evenodd');
    vctx.globalAlpha = 1;
    vctx.lineWidth = edgeLineWidth;
    vctx.strokeStyle = '#ffffff';
    vctx.lineJoin = 'round';
    vctx.lineCap = 'round';
    vctx.stroke(path);
    vctx.restore();

    // Id-map follows the smoothed contour: rasterize the same Path2D
    // onto the scratch canvas in opaque white, threshold its alpha,
    // and stamp the mask id at every covered bake pixel. Hit-testing
    // therefore lines up with the visible curve instead of snapping
    // to the raw mask's stairsteps.
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = '#ffffff';
    sctx.fill(path, 'evenodd');
    const { data: alpha } = sctx.getImageData(0, 0, w, h);
    const wh = w * h;
    for (let p = 0; p < wh; p++) {
      if ((alpha[p * 4 + 3] ?? 0) > ALPHA_THRESHOLD) idMap[p] = id;
    }
    idToMask.push({ tag: m.tag, maskIndex: m.maskIndex });
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, idMap, idToMask, width: w, height: h };
}
