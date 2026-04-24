import type { ParsedAnnotation } from './types';

export function isVocXml(text: string): boolean {
  const head = text.slice(0, 1024);
  return /<annotation[\s>]/.test(head);
}

export function parseVoc(text: string): ParsedAnnotation[] {
  const sizeMatch = text.match(/<size>([\s\S]*?)<\/size>/);
  if (!sizeMatch) throw new Error('VOC xml missing <size>');
  const imageWidth = readInt(sizeMatch[1]!, 'width');
  const imageHeight = readInt(sizeMatch[1]!, 'height');

  const objects = text.matchAll(/<object>([\s\S]*?)<\/object>/g);
  const out: ParsedAnnotation[] = [];
  for (const m of objects) {
    const body = m[1]!;
    const nameMatch = body.match(/<name>\s*([^<]+?)\s*<\/name>/);
    const bbox = body.match(/<bndbox>([\s\S]*?)<\/bndbox>/);
    if (!nameMatch || !bbox) continue;
    const xmin = readInt(bbox[1]!, 'xmin');
    const ymin = readInt(bbox[1]!, 'ymin');
    const xmax = readInt(bbox[1]!, 'xmax');
    const ymax = readInt(bbox[1]!, 'ymax');
    out.push({
      className: nameMatch[1]!,
      imageWidth,
      imageHeight,
      bbox: [xmin, ymin, xmax, ymax],
      geometry: { kind: 'bbox' },
    });
  }
  return out;
}

function readInt(scope: string, tag: string): number {
  const m = scope.match(new RegExp(`<${tag}>\\s*([\\d.]+)\\s*</${tag}>`));
  if (!m) throw new Error(`VOC xml missing <${tag}>`);
  const n = Math.round(Number(m[1]));
  if (!Number.isFinite(n)) throw new Error(`VOC xml bad <${tag}> value`);
  return n;
}
