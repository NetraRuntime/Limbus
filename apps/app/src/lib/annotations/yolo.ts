import type { ClassMap, ParsedAnnotation } from './types';

export function parseYolo(
  text: string,
  classMap: ClassMap,
  imageSize: { width: number; height: number },
): ParsedAnnotation[] {
  const out: ParsedAnnotation[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const classIndex = Number.parseInt(parts[0]!, 10);
    if (!Number.isInteger(classIndex) || classIndex < 0) continue;
    const floats = parts.slice(1).map(Number);
    if (floats.some((n) => !Number.isFinite(n))) continue;

    const className = classMap.names[classIndex] ?? `class_${classIndex}`;
    let annotation: ParsedAnnotation | null = null;

    if (floats.length === 4) {
      const [cx, cy, w, h] = floats as [number, number, number, number];
      const x1 = (cx - w / 2) * imageSize.width;
      const y1 = (cy - h / 2) * imageSize.height;
      const x2 = (cx + w / 2) * imageSize.width;
      const y2 = (cy + h / 2) * imageSize.height;
      annotation = {
        className,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        bbox: [round(x1), round(y1), round(x2), round(y2)],
        geometry: { kind: 'bbox' },
      };
    } else if (floats.length >= 6 && floats.length % 2 === 0) {
      const ring: number[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < floats.length; i += 2) {
        const px = floats[i]! * imageSize.width;
        const py = floats[i + 1]! * imageSize.height;
        ring.push(round(px), round(py));
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      annotation = {
        className,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        bbox: [round(minX), round(minY), round(maxX), round(maxY)],
        geometry: { kind: 'polygon', rings: [ring] },
      };
    }

    if (annotation) out.push(annotation);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n);
}
