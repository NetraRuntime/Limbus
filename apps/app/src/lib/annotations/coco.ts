import type { ParsedAnnotation } from './types';

export type CocoJson = {
  images: Array<{ id: number; file_name: string; width: number; height: number }>;
  annotations: Array<{
    image_id: number;
    category_id: number;
    bbox: [number, number, number, number];
    segmentation?: number[][] | { counts: number[] | string; size: [number, number] };
  }>;
  categories: Array<{ id: number; name: string }>;
};

export function isCocoJson(v: unknown): v is CocoJson {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.images) && Array.isArray(o.annotations) && Array.isArray(o.categories);
}

export function cocoImageFilenames(json: CocoJson): string[] {
  return json.images.map((i) => i.file_name);
}

export type CocoParsed = { imageId: number; annotation: ParsedAnnotation };

export function parseCoco(json: CocoJson): CocoParsed[] {
  const imagesById = new Map(json.images.map((i) => [i.id, i]));
  const categoriesById = new Map(json.categories.map((c) => [c.id, c.name]));
  const out: CocoParsed[] = [];

  for (const ann of json.annotations) {
    const img = imagesById.get(ann.image_id);
    if (!img) continue;
    const className = categoriesById.get(ann.category_id);
    if (!className) continue;

    const [x, y, w, h] = ann.bbox;
    const bbox: [number, number, number, number] = [x, y, x + w, y + h];

    let geometry: ParsedAnnotation['geometry'] = { kind: 'bbox' };
    const seg = ann.segmentation;
    if (Array.isArray(seg) && seg.length > 0) {
      geometry = { kind: 'polygon', rings: seg.map((ring) => ring.slice()) };
    } else if (seg && typeof seg === 'object' && 'counts' in seg) {
      const [hh, ww] = seg.size;
      const counts = typeof seg.counts === 'string' ? decodeCompressedRle(seg.counts) : seg.counts.slice();
      geometry = { kind: 'rle', counts, width: ww, height: hh };
    }

    out.push({
      imageId: ann.image_id,
      annotation: {
        className,
        imageWidth: img.width,
        imageHeight: img.height,
        bbox,
        geometry,
      },
    });
  }
  return out;
}

/** Port of pycocotools' rleFrString: 6-bit LEB128-like, every other run subtracts previous. */
export function decodeCompressedRle(s: string): number[] {
  const counts: number[] = [];
  let p = 0;
  while (p < s.length) {
    let x = 0;
    let k = 0;
    let more = 1;
    while (more) {
      const c = s.charCodeAt(p) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = c & 0x20;
      p++;
      k++;
      if (!more && c & 0x10) x |= -1 << (5 * k);
    }
    if (counts.length > 2) x += counts[counts.length - 2]!;
    counts.push(x);
  }
  return counts;
}
