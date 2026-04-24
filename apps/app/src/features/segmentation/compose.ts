import type { ComposedBake, ComposeInput, HitMask } from './types';
import { capDims } from './dims';
import { strokeWidthFor } from './stroke';
import { extractContours, ringsToPath, smoothChaikin, type Point } from './contours';

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
 * its native size. Used to sample mask alpha for contour extraction.
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

/** Axis-aligned bounding rectangle of a set of rings in their own coord space. */
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

/**
 * Compose all ready masks for a single image into one ImageBitmap + a
 * per-mask hit-test record. For each mask:
 *
 *   - Binarize the mask alpha at ALPHA_THRESHOLD.
 *   - Extract closed boundary rings via marching squares (with a
 *     virtual outside border so masks at the grid edge close cleanly).
 *   - Smooth each ring with Chaikin's algorithm so the visible contour
 *     traces a curve instead of an axis-aligned staircase.
 *   - Scale rings from mask-pixel to bake-pixel space.
 *   - Fill the resulting Path2D with the accent color at FILL_ALPHA
 *     and stroke it in white for the edge ring.
 *   - Record the smoothed rings + their bbox so the main thread can
 *     hit-test against them without storing a per-pixel id map.
 *
 * Layering: later masks paint over earlier ones, so iterating the
 * returned `hitMasks` in reverse yields topmost-first.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const hitMasks: HitMask[] = [];
  // Edge-ring thickness in bake pixels. Derived from the overall stroke
  // width so it tracks bake dimensions.
  const edgeLineWidth = Math.max(1, Math.round(strokeWidthFor(w, h) * 0.75));

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);

    // Sample the mask as a continuous scalar field. SAM3 puts the mask
    // in the alpha channel for some encoders and in luminance for
    // others — `max(R, G, B, A)` is robust to both.
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
    // Rings in bake-pixel space — persisted for hit-testing.
    const scaled: Point[][] = smoothed.map((ring) =>
      ring.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
    );
    const path = ringsToPath(scaled);

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
