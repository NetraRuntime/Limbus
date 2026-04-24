import type { Geometry } from './types';

export type Size = { width: number; height: number };
export type BBox = [number, number, number, number];

/** Returns an RGBA Uint8ClampedArray (width*height*4) with the geometry's
 *  covered pixels set to (255,255,255,255). Pure. */
export function geometryToMaskBytes(
  geometry: Geometry,
  size: Size,
  context: { bbox: BBox },
): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(size.width * size.height * 4);
  if (geometry.kind === 'bbox') {
    fillRect(bytes, size, context.bbox);
  } else if (geometry.kind === 'polygon') {
    for (const ring of geometry.rings) {
      fillPolygon(bytes, size, ring);
    }
  } else if (geometry.kind === 'rle') {
    fillRle(bytes, size, geometry);
  }
  return bytes;
}

function setPixel(bytes: Uint8ClampedArray, size: Size, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= size.width || y >= size.height) return;
  const i = (y * size.width + x) * 4;
  bytes[i] = 255;
  bytes[i + 1] = 255;
  bytes[i + 2] = 255;
  bytes[i + 3] = 255;
}

function fillRect(bytes: Uint8ClampedArray, size: Size, bbox: BBox): void {
  const [x1, y1, x2, y2] = bbox;
  for (let y = Math.max(0, y1); y < Math.min(size.height, y2); y++) {
    for (let x = Math.max(0, x1); x < Math.min(size.width, x2); x++) {
      setPixel(bytes, size, x, y);
    }
  }
}

/** Scanline polygon fill (even-odd). Ring is [x0,y0,x1,y1,...]. */
function fillPolygon(bytes: Uint8ClampedArray, size: Size, ring: number[]): void {
  if (ring.length < 6) return;
  const n = ring.length / 2;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = ring[i * 2 + 1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(size.height - 1, Math.ceil(maxY));
  for (let y = startY; y <= endY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2]!;
      const ay = ring[i * 2 + 1]!;
      const bx = ring[j * 2]!;
      const by = ring[j * 2 + 1]!;
      if (ay === by) continue;
      if (y < Math.min(ay, by) || y >= Math.max(ay, by)) continue;
      const t = (y - ay) / (by - ay);
      xs.push(ax + t * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.floor(xs[k]!));
      const to = Math.min(size.width - 1, Math.ceil(xs[k + 1]!));
      for (let x = from; x <= to; x++) setPixel(bytes, size, x, y);
    }
  }
}

/** COCO column-major RLE: counts[i] runs of bit i&1, starting with 0s. */
function fillRle(
  bytes: Uint8ClampedArray,
  size: Size,
  rle: { counts: number[]; width: number; height: number },
): void {
  let flat = 0;
  const total = rle.width * rle.height;
  for (let i = 0; i < rle.counts.length; i++) {
    const run = rle.counts[i]!;
    const value = i & 1;
    if (value === 1) {
      for (let k = 0; k < run; k++) {
        const linear = flat + k;
        if (linear >= total) break;
        const col = Math.floor(linear / rle.height);
        const row = linear % rle.height;
        setPixel(bytes, size, col, row);
      }
    }
    flat += run;
  }
}

// ---- Browser-only glue below. ----

/** Encodes RGBA bytes to a base64 PNG string (no `data:` prefix). */
export async function maskBytesToPngBase64(
  bytes: Uint8ClampedArray,
  size: Size,
): Promise<string> {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size.width, size.height)
      : document.createElement('canvas');
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const owned = new Uint8ClampedArray(new ArrayBuffer(bytes.byteLength));
  owned.set(bytes);
  const image = new ImageData(owned, size.width, size.height);
  (ctx as CanvasRenderingContext2D).putImageData(image, 0, 0);

  const blob: Blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
            'image/png',
          ),
        );
  const buf = new Uint8Array(await blob.arrayBuffer());
  return uint8ArrayToBase64(buf);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
