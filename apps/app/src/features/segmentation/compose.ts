import type { ComposedBake, ComposeInput } from './types';
import { capDims } from './dims';
import { scaleBboxToBake } from './bbox';
import { strokeWidthFor } from './stroke';
import { buildIdMap } from './idMap';

const DEFAULT_MAX_SIDE = 2048;
const ID_THRESHOLD = 128;

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
 * its native size. Used for the id-map pass.
 */
function readBitmapPixels(bmp: ReadableBitmap): {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const off = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = off.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { rgba: data.data, w: bmp.width, h: bmp.height };
}

/**
 * Compose all ready masks for a single image into a single
 * ImageBitmap + id-map. Layers masks in input order; later masks
 * paint over earlier ones, so the topmost mask wins hit-tests in the
 * id-map.
 */
export async function composeBake(input: ComposeInput): Promise<ComposedBake> {
  const maxSide = input.maxSide ?? DEFAULT_MAX_SIDE;
  const { w, h } = capDims(input.sourceW, input.sourceH, maxSide);

  const visual = new OffscreenCanvas(w, h);
  const vctx = visual.getContext('2d');
  if (!vctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const scratch = new OffscreenCanvas(w, h);
  const sctx = scratch.getContext('2d');
  if (!sctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const idMap = new Uint16Array(w * h);
  const idToMask: Array<{ tag: string; maskIndex: number }> = [];
  const lineWidth = strokeWidthFor(w, h);

  for (let i = 0; i < input.masks.length; i++) {
    const m = input.masks[i]!;
    const id = i + 1;
    const bmp = await getMaskBitmap(input.decodeCache, m.png_base64);

    // Visual: draw the mask rescaled to bake dims → source-in fill with
    // accent → draw the tinted scratch onto the visible canvas at 0.5
    // alpha.
    sctx.save();
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(bmp, 0, 0, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = m.accent;
    sctx.fillRect(0, 0, w, h);
    sctx.restore();

    vctx.save();
    vctx.globalAlpha = 0.5;
    vctx.drawImage(scratch, 0, 0);
    vctx.restore();

    // Bbox stroke in bake space.
    const rect = scaleBboxToBake(m.bbox, m.maskW, m.maskH, w, h);
    if (rect) {
      vctx.save();
      vctx.strokeStyle = m.accent;
      vctx.lineWidth = lineWidth;
      vctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      vctx.restore();
    }

    // Id pass: sample the mask's own pixels at native resolution;
    // `buildIdMap` handles nearest-neighbour rescale into bake space.
    const { rgba, w: mw, h: mh } = readBitmapPixels(bmp);
    buildIdMap(idMap, w, h, rgba, mw, mh, id, ID_THRESHOLD);
    idToMask.push({ tag: m.tag, maskIndex: m.maskIndex });
  }

  const bitmap = visual.transferToImageBitmap();
  return { bitmap, idMap, idToMask, width: w, height: h };
}
