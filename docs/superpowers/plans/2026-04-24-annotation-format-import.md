# Annotation Format Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make zip and folder uploads in NetraRT accept COCO, YOLO, and Pascal VOC annotations and materialize them as segmentation masks on the canvas.

**Architecture:** Annotations are detected in a new post-scan step on the existing `mediaIngest` pipeline, surfaced in the existing `ImportPreviewModal`, and upserted to the existing `segmentations` PocketBase collection after image upload. Parsers are pure and per-format; geometry → raster conversion is split into pure byte-array generation (testable in Node) and a thin PNG wrapper (canvas-based, browser-only). No PB schema changes, no new dependencies.

**Tech Stack:** TypeScript, Vitest (node + jsdom workspaces), React, existing `fflate` for zip, existing PocketBase client. Spec: `docs/superpowers/specs/2026-04-24-annotation-format-import-design.md`.

---

## Task 1: Scaffold `lib/annotations/` with shared types

**Files:**
- Create: `apps/app/src/lib/annotations/types.ts`
- Create: `apps/app/src/lib/annotations/index.ts`

- [ ] **Step 1: Write the types file**

```ts
// apps/app/src/lib/annotations/types.ts

export type AnnotationFormat = 'coco' | 'yolo' | 'voc';

/** A single annotation in intermediate form, before rasterization. */
export type ParsedAnnotation = {
  className: string;
  imageWidth: number;
  imageHeight: number;
  /** Pixel-space bbox [x1, y1, x2, y2]. Always present when known; may be
   *  derived from polygon/rle bounds if the source only carries geometry. */
  bbox: [number, number, number, number];
  geometry: Geometry;
};

export type Geometry =
  | { kind: 'bbox' }
  | { kind: 'polygon'; rings: number[][] } // each ring is [x1,y1,x2,y2,...] pixel-space
  | { kind: 'rle'; counts: number[]; height: number; width: number }; // uncompressed RLE

/** COCO supports a 'compressed' RLE string; we decode it to `counts: number[]`
 *  before producing a Geometry so downstream rasterization has one code path. */

export type ClassMap = {
  /** `names[i]` is the display name for class index i (YOLO). */
  names: string[];
  /** Optional source file path for warnings. */
  sourcePath?: string;
};

export type AnnotationSource =
  | { format: 'coco'; descriptor: AnnotationFileRef; classes: string[] }
  | { format: 'yolo'; descriptor: AnnotationFileRef; imageDescriptorPath: string; classMap: ClassMap }
  | { format: 'voc'; descriptor: AnnotationFileRef; imageDescriptorPath: string };

export type AnnotationFileRef = {
  relativePath: string;
  load(): Promise<string>;
};

export type AnnotationPlan = {
  format: AnnotationFormat | 'mixed' | 'none';
  /** Per-format details; populated for any format that had at least one match. */
  perFormat: Partial<Record<AnnotationFormat, PerFormat>>;
  /** Union of classes across all detected formats, deduped, lowercased. */
  classes: string[];
  imagesWithAnnotations: number;
  totalAnnotations: number;
  unmatchedAnnotations: number;
  warnings: string[];
  /** Executable parser refs. Filtered to the chosen format after the user
   *  confirms in the modal (when format === 'mixed'). */
  sources: AnnotationSource[];
};

export type PerFormat = {
  imagesWithAnnotations: number;
  totalAnnotations: number;
  classes: string[];
  unmatchedAnnotations: number;
};
```

- [ ] **Step 2: Write the barrel file**

```ts
// apps/app/src/lib/annotations/index.ts

export type {
  AnnotationFormat,
  AnnotationPlan,
  AnnotationSource,
  ClassMap,
  Geometry,
  ParsedAnnotation,
  PerFormat,
} from './types';
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/annotations/types.ts apps/app/src/lib/annotations/index.ts
git commit -m "feat(annotations): scaffold types module"
```

---

## Task 2: Class-list reader (YOLO)

**Files:**
- Create: `apps/app/src/lib/annotations/classMap.ts`
- Test: `apps/app/src/lib/annotations/classMap.test.ts`

YOLO ships class names as one of: `data.yaml` (`names: [...]` or `names:\n  0: cat\n  1: dog`), `classes.txt` (newline-separated), or `obj.names` (same format as `classes.txt`).

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/classMap.test.ts
import { describe, it, expect } from 'vitest';
import { parseClassList } from './classMap';

describe('parseClassList', () => {
  it('parses classes.txt / obj.names newline-separated', () => {
    const text = 'cat\ndog\n\n tree \n';
    expect(parseClassList(text, 'classes.txt').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a flow-style names list', () => {
    const text = 'train: ./train\nnames: [cat, dog, tree]\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a block-style indexed map', () => {
    const text = 'names:\n  0: cat\n  1: dog\n  2: tree\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog', 'tree']);
  });

  it('parses data.yaml with a block-style list (dash items)', () => {
    const text = 'names:\n  - cat\n  - dog\n';
    expect(parseClassList(text, 'data.yaml').names).toEqual(['cat', 'dog']);
  });

  it('returns empty names when no recognizable list is present', () => {
    expect(parseClassList('train: ./t\n', 'data.yaml').names).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- classMap.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the parser**

```ts
// apps/app/src/lib/annotations/classMap.ts
import type { ClassMap } from './types';

export function parseClassList(text: string, sourcePath: string): ClassMap {
  const ext = sourcePath.toLowerCase().split('.').pop() ?? '';
  const names = ext === 'yaml' || ext === 'yml'
    ? parseYamlNames(text)
    : parsePlainList(text);
  return { names, sourcePath };
}

function parsePlainList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseYamlNames(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: Array<{ index: number | null; name: string }> = [];
  let inNamesBlock = false;
  let autoIndex = 0;

  for (const rawLine of lines) {
    const flowMatch = rawLine.match(/^\s*names\s*:\s*\[(.+)\]\s*$/);
    if (flowMatch) {
      return flowMatch[1]!
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter((s) => s.length > 0);
    }
    if (/^\s*names\s*:\s*$/.test(rawLine)) {
      inNamesBlock = true;
      continue;
    }
    if (!inNamesBlock) continue;
    // End of block: unindented non-empty line.
    if (/^\S/.test(rawLine)) break;

    const dashMatch = rawLine.match(/^\s*-\s*(.+?)\s*$/);
    if (dashMatch) {
      out.push({ index: null, name: stripQuotes(dashMatch[1]!) });
      autoIndex++;
      continue;
    }
    const indexedMatch = rawLine.match(/^\s*(\d+)\s*:\s*(.+?)\s*$/);
    if (indexedMatch) {
      out.push({ index: Number(indexedMatch[1]), name: stripQuotes(indexedMatch[2]!) });
      continue;
    }
  }

  if (out.length === 0) return [];
  const hasIndices = out.some((e) => e.index !== null);
  if (!hasIndices) return out.map((e) => e.name);
  const maxIndex = Math.max(...out.map((e) => e.index ?? -1));
  const arr: string[] = new Array(maxIndex + 1).fill('');
  for (const e of out) {
    if (e.index !== null) arr[e.index] = e.name;
  }
  return arr;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- classMap.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/annotations/classMap.ts apps/app/src/lib/annotations/classMap.test.ts
git commit -m "feat(annotations): add YOLO class-list parser"
```

---

## Task 3: Pascal VOC parser

**Files:**
- Create: `apps/app/src/lib/annotations/voc.ts`
- Test: `apps/app/src/lib/annotations/voc.test.ts`

VOC annotations are XML with `<annotation>` root, `<size><width/height>`, and `<object><name/><bndbox><xmin/ymin/xmax/ymax>`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/voc.test.ts
import { describe, it, expect } from 'vitest';
import { parseVoc, isVocXml } from './voc';

const sample = `<?xml version="1.0"?>
<annotation>
  <size><width>640</width><height>480</height><depth>3</depth></size>
  <object>
    <name>cat</name>
    <bndbox><xmin>10</xmin><ymin>20</ymin><xmax>110</xmax><ymax>220</ymax></bndbox>
  </object>
  <object>
    <name>Dog</name>
    <bndbox><xmin>200</xmin><ymin>50</ymin><xmax>400</xmax><ymax>300</ymax></bndbox>
  </object>
</annotation>`;

describe('isVocXml', () => {
  it('detects VOC by root tag in the first 1KB', () => {
    expect(isVocXml(sample)).toBe(true);
    expect(isVocXml('<?xml version="1.0"?><root/>')).toBe(false);
  });
});

describe('parseVoc', () => {
  it('returns bbox ParsedAnnotations with class name and image size', () => {
    const out = parseVoc(sample);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      className: 'cat',
      imageWidth: 640,
      imageHeight: 480,
      bbox: [10, 20, 110, 220],
      geometry: { kind: 'bbox' },
    });
    expect(out[1]!.className).toBe('Dog');
    expect(out[1]!.bbox).toEqual([200, 50, 400, 300]);
  });

  it('throws on missing size element', () => {
    expect(() => parseVoc('<annotation><object><name>x</name></object></annotation>'))
      .toThrow(/size/);
  });

  it('skips objects without bndbox', () => {
    const bad = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name></object>
    </annotation>`;
    expect(parseVoc(bad)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- voc.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the parser**

Uses a minimal regex-based extractor — jsdom is available but not as a node-environment default, and a `DOMParser` shim for node tests would add overhead. VOC files are small, predictable, well-formed.

```ts
// apps/app/src/lib/annotations/voc.ts
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- voc.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/annotations/voc.ts apps/app/src/lib/annotations/voc.test.ts
git commit -m "feat(annotations): add Pascal VOC parser"
```

---

## Task 4: COCO parser (bbox + polygon + RLE)

**Files:**
- Create: `apps/app/src/lib/annotations/coco.ts`
- Test: `apps/app/src/lib/annotations/coco.test.ts`

COCO JSON shape (subset we care about):
```json
{
  "images": [{"id": 1, "file_name": "a.jpg", "width": 640, "height": 480}],
  "annotations": [
    {"image_id": 1, "category_id": 1, "bbox": [x,y,w,h], "segmentation": [...]}
  ],
  "categories": [{"id": 1, "name": "cat"}]
}
```
`segmentation` can be: `[[x1,y1,...], ...]` (polygons), or `{counts: number[]|string, size: [h,w]}` (RLE, uncompressed or compressed).

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/coco.test.ts
import { describe, it, expect } from 'vitest';
import { isCocoJson, parseCoco, cocoImageFilenames } from './coco';

const baseJson = {
  images: [
    { id: 1, file_name: 'a.jpg', width: 100, height: 80 },
    { id: 2, file_name: 'sub/b.png', width: 50, height: 50 },
  ],
  annotations: [
    { image_id: 1, category_id: 1, bbox: [10, 20, 30, 40] },
    {
      image_id: 2,
      category_id: 2,
      bbox: [5, 5, 10, 10],
      segmentation: [[5, 5, 15, 5, 15, 15, 5, 15]],
    },
    {
      image_id: 1,
      category_id: 2,
      bbox: [0, 0, 10, 10],
      segmentation: { counts: [0, 5, 75, 5, 5, 10], size: [80, 100] },
    },
  ],
  categories: [
    { id: 1, name: 'cat' },
    { id: 2, name: 'dog' },
  ],
};

describe('isCocoJson', () => {
  it('detects COCO shape', () => {
    expect(isCocoJson(baseJson)).toBe(true);
    expect(isCocoJson({})).toBe(false);
    expect(isCocoJson({ images: [], annotations: [] })).toBe(false); // missing categories
  });
});

describe('cocoImageFilenames', () => {
  it('returns file_name values', () => {
    expect(cocoImageFilenames(baseJson)).toEqual(['a.jpg', 'sub/b.png']);
  });
});

describe('parseCoco', () => {
  it('emits bbox-only annotations when segmentation is absent', () => {
    const out = parseCoco(baseJson);
    const bboxOnly = out.filter((p) => p.annotation.geometry.kind === 'bbox');
    expect(bboxOnly).toHaveLength(1);
    expect(bboxOnly[0]!.imageId).toBe(1);
    expect(bboxOnly[0]!.annotation).toMatchObject({
      className: 'cat',
      imageWidth: 100,
      imageHeight: 80,
      bbox: [10, 20, 40, 60],
    });
  });

  it('emits polygon geometry when segmentation is array-of-arrays', () => {
    const out = parseCoco(baseJson);
    const poly = out.find((p) => p.annotation.geometry.kind === 'polygon');
    expect(poly).toBeDefined();
    expect(poly!.annotation.className).toBe('dog');
    const g = poly!.annotation.geometry as { kind: 'polygon'; rings: number[][] };
    expect(g.rings).toEqual([[5, 5, 15, 5, 15, 15, 5, 15]]);
  });

  it('emits rle geometry when segmentation is an RLE object', () => {
    const out = parseCoco(baseJson);
    const rle = out.find((p) => p.annotation.geometry.kind === 'rle');
    expect(rle).toBeDefined();
    const g = rle!.annotation.geometry as { kind: 'rle'; counts: number[]; width: number; height: number };
    expect(g.width).toBe(100);
    expect(g.height).toBe(80);
    expect(g.counts).toEqual([0, 5, 75, 5, 5, 10]);
  });

  it('decodes compressed RLE counts string to numbers that sum to width*height', () => {
    const withCompressed = {
      ...baseJson,
      annotations: [
        { image_id: 1, category_id: 1, bbox: [0, 0, 2, 2], segmentation: { counts: '0`0', size: [2, 2] } },
      ],
    };
    const out = parseCoco(withCompressed as unknown as Parameters<typeof parseCoco>[0]);
    const g = out[0]!.annotation.geometry as { kind: 'rle'; counts: number[]; width: number; height: number };
    expect(g.kind).toBe('rle');
    const sum = g.counts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(g.width * g.height);
  });

  it('skips annotations whose image_id has no matching image', () => {
    const orphan = {
      ...baseJson,
      annotations: [{ image_id: 999, category_id: 1, bbox: [0, 0, 1, 1] }],
    };
    expect(parseCoco(orphan as unknown as Parameters<typeof parseCoco>[0])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- coco.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the parser**

```ts
// apps/app/src/lib/annotations/coco.ts
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

/** COCO compressed RLE string decode.
 *  Port of pycocotools' rleFrString: 6-bit LEB128-like, with every other
 *  run subtracting the previous run's value. */
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- coco.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/annotations/coco.ts apps/app/src/lib/annotations/coco.test.ts
git commit -m "feat(annotations): add COCO parser with polygon and RLE support"
```

---

## Task 5: YOLO parser (bbox + polygon)

**Files:**
- Create: `apps/app/src/lib/annotations/yolo.ts`
- Test: `apps/app/src/lib/annotations/yolo.test.ts`

YOLO sidecar `.txt`, one row per object:
- Detect: `class_id cx cy w h` (normalized 0..1, center-based).
- Seg: `class_id x1 y1 x2 y2 ... xn yn` (normalized 0..1 polygon).

Rows with 5 floats after class id → bbox. Rows with > 5 floats and an even count → polygon.

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/yolo.test.ts
import { describe, it, expect } from 'vitest';
import { parseYolo } from './yolo';

describe('parseYolo', () => {
  const classMap = { names: ['cat', 'dog', 'tree'] };
  const imageSize = { width: 100, height: 80 };

  it('parses normalized bbox rows to pixel-space bbox annotations', () => {
    const text = '0 0.5 0.5 0.2 0.25\n1 0.1 0.1 0.2 0.2\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      className: 'cat',
      imageWidth: 100,
      imageHeight: 80,
      bbox: [40, 30, 60, 50],
      geometry: { kind: 'bbox' },
    });
    expect(out[1]!.className).toBe('dog');
  });

  it('parses polygon rows (>5 floats, even count after class id)', () => {
    const text = '2 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out).toHaveLength(1);
    expect(out[0]!.geometry).toEqual({
      kind: 'polygon',
      rings: [[10, 8, 30, 8, 30, 24, 10, 24]],
    });
    expect(out[0]!.bbox).toEqual([10, 8, 30, 24]);
  });

  it('falls back to class_N when class index is out of range', () => {
    const text = '9 0.5 0.5 0.2 0.2\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out[0]!.className).toBe('class_9');
  });

  it('skips blank lines and comments', () => {
    const text = '\n# header\n0 0.5 0.5 0.2 0.2\n';
    expect(parseYolo(text, classMap, imageSize)).toHaveLength(1);
  });

  it('skips malformed rows (odd number of polygon coords)', () => {
    const text = '0 0.1 0.1 0.2 0.2 0.3\n';
    expect(parseYolo(text, classMap, imageSize)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- yolo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the parser**

```ts
// apps/app/src/lib/annotations/yolo.ts
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- yolo.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/annotations/yolo.ts apps/app/src/lib/annotations/yolo.test.ts
git commit -m "feat(annotations): add YOLO parser with polygon support"
```

---

## Task 6: Pure geometry → RGBA mask bytes

**Files:**
- Create: `apps/app/src/lib/annotations/rasterize.ts` (partial — pure geometry only)
- Test: `apps/app/src/lib/annotations/rasterize.test.ts`

The rasterizer has two halves. This task writes the pure half: takes a `Geometry` + output size, returns a `Uint8ClampedArray` of RGBA bytes (same shape as `ImageData.data`). Fully testable in node.

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/rasterize.test.ts
import { describe, it, expect } from 'vitest';
import { geometryToMaskBytes } from './rasterize';
import type { Geometry } from './types';

const FILL = [255, 255, 255, 255] as const;
const CLEAR = [0, 0, 0, 0] as const;

function pixelAt(bytes: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!];
}

describe('geometryToMaskBytes — bbox', () => {
  it('fills the bbox rectangle in image-space', () => {
    const g: Geometry = { kind: 'bbox' };
    const bytes = geometryToMaskBytes(g, { width: 10, height: 10 }, { bbox: [2, 3, 5, 6] });
    expect(bytes.length).toBe(10 * 10 * 4);
    expect(pixelAt(bytes, 10, 0, 0)).toEqual([...CLEAR]);
    expect(pixelAt(bytes, 10, 2, 3)).toEqual([...FILL]);
    expect(pixelAt(bytes, 10, 4, 5)).toEqual([...FILL]);
    expect(pixelAt(bytes, 10, 5, 6)).toEqual([...CLEAR]); // exclusive end
  });
});

describe('geometryToMaskBytes — polygon', () => {
  it('fills a square polygon', () => {
    const g: Geometry = { kind: 'polygon', rings: [[1, 1, 4, 1, 4, 4, 1, 4]] };
    const bytes = geometryToMaskBytes(g, { width: 6, height: 6 }, { bbox: [1, 1, 4, 4] });
    expect(pixelAt(bytes, 6, 2, 2)).toEqual([...FILL]);
    expect(pixelAt(bytes, 6, 0, 0)).toEqual([...CLEAR]);
    expect(pixelAt(bytes, 6, 5, 5)).toEqual([...CLEAR]);
  });
});

describe('geometryToMaskBytes — rle', () => {
  it('decodes column-major COCO RLE into the correct pixels', () => {
    // Size 4x4. Counts alternate starting with 0s: 0 zeros, 4 ones, 4 zeros, 8 ones.
    // Column-major: column 0 all 1s, column 1 all 0s, columns 2+3 all 1s.
    const g: Geometry = { kind: 'rle', counts: [0, 4, 4, 8], width: 4, height: 4 };
    const bytes = geometryToMaskBytes(g, { width: 4, height: 4 }, { bbox: [0, 0, 4, 4] });
    expect(pixelAt(bytes, 4, 0, 0)).toEqual([...FILL]); // col 0
    expect(pixelAt(bytes, 4, 1, 0)).toEqual([...CLEAR]); // col 1
    expect(pixelAt(bytes, 4, 2, 0)).toEqual([...FILL]); // col 2
    expect(pixelAt(bytes, 4, 3, 3)).toEqual([...FILL]); // col 3
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- rasterize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pure geometry rasterization**

```ts
// apps/app/src/lib/annotations/rasterize.ts
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
  let flat = 0; // linear position in the column-major mask of size rle.height * rle.width
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- rasterize.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/annotations/rasterize.ts apps/app/src/lib/annotations/rasterize.test.ts
git commit -m "feat(annotations): pure geometry → RGBA mask bytes"
```

---

## Task 7: RGBA bytes → base64 PNG (browser wrapper)

**Files:**
- Modify: `apps/app/src/lib/annotations/rasterize.ts`

Add a thin wrapper that runs in the browser: `maskBytesToPngBase64(bytes, size)` using `OffscreenCanvas` (or `HTMLCanvasElement` fallback). No test — it's a thin glue layer covered by Task 15 manual E2E. Unit-testing canvas APIs in jsdom is flaky and not worth the setup.

- [ ] **Step 1: Append to rasterize.ts**

```ts
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
  const image = new ImageData(bytes, size.width, size.height);
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
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/annotations/rasterize.ts
git commit -m "feat(annotations): encode mask bytes to base64 PNG"
```

---

## Task 8: Extend `mediaIngest` to classify and emit annotation files

**Files:**
- Modify: `apps/app/src/lib/mediaIngest.ts`
- Modify: `apps/app/src/lib/mediaIngest.test.ts`

We need annotation files (`.json`, `.txt`, `.xml`, `.yaml`, `.yml`, `.names`) to flow through the same scan → descriptor pipeline as images. Do it by (a) widening `MediaKind` to include `'annotation'` and (b) carrying the file bytes so parsers can `load()` later.

- [ ] **Step 1: Write failing tests for the widened classifier**

Append to `apps/app/src/lib/mediaIngest.test.ts`:

```ts
describe('classifyByExtension — annotations', () => {
  it('recognizes annotation extensions', () => {
    for (const n of ['a.json', 'a.txt', 'a.xml', 'a.yaml', 'a.yml', 'a.names']) {
      expect(classifyByExtension(n), n).toBe('annotation');
    }
  });
});

describe('extractZipRecursive — annotations', () => {
  it('emits descriptors for annotation files alongside images', () => {
    const zip = buildZip({
      'img/a.jpg': tinyPng(),
      'labels/a.txt': strToU8('0 0.5 0.5 0.2 0.2'),
      'notes.md': strToU8('ignored'),
    });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const kinds = descs.map((d) => d.kind).sort();
    expect(kinds).toEqual(['annotation', 'image']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- mediaIngest.test.ts`
Expected: FAIL — classifier returns `null` for `.txt` etc.

- [ ] **Step 3: Widen types and classifier**

In `apps/app/src/lib/mediaIngest.ts`, replace the `MediaKind` type and add an annotation extension set and update `classifyByExtension` + `mimeFromExtension`:

```ts
export type MediaKind = 'image' | 'video' | 'annotation';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi', '3gp',
]);
const ANNOTATION_EXTS = new Set([
  'json', 'txt', 'xml', 'yaml', 'yml', 'names',
]);

export function classifyByExtension(name: string): MediaKind | 'zip' | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === 'zip') return 'zip';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ANNOTATION_EXTS.has(ext)) return 'annotation';
  return null;
}
```

Update the `kind !== 'image' && kind !== 'video'` guards inside `extractZipRecursive` and `buildDescriptorFromFile` so they also accept `'annotation'`:

In `extractZipRecursive`, change:
```ts
if (kind !== 'image' && kind !== 'video') continue;
```
to:
```ts
if (kind !== 'image' && kind !== 'video' && kind !== 'annotation') continue;
```

Same change in `buildDescriptorFromFile`:
```ts
if (kind !== 'image' && kind !== 'video' && kind !== 'annotation') return [];
```

Update `descriptorFromTauriEntry`:
```ts
if (kind !== 'image' && kind !== 'video' && kind !== 'annotation') return null;
```

- [ ] **Step 4: Update downstream consumers that assume kind is image|video**

Run: `grep -rn "kind === 'image' \|\| kind === 'video'\|d.kind === 'video'\|descriptor.kind === 'video'" apps/app/src`

Expected hits (fix each):
- `apps/app/src/hooks/useImportPreview.ts` — `imageCount` / `videoCount` accumulators: leave as is (annotation descriptors won't match either, which is the correct default).
- `apps/app/src/Canvas.tsx` `importDescriptors` — filter `descriptors` to only `kind === 'image' || 'video'` before creating UploadPlan entries. Annotations must NOT be uploaded as media.

In `apps/app/src/Canvas.tsx`, at the top of `importDescriptors`:

```ts
const mediaDescriptors = descriptors.filter(
  (d) => d.kind === 'image' || d.kind === 'video',
);
// pass mediaDescriptors to the existing files loop below
```

Rename every subsequent reference to `descriptors` within `importDescriptors` to `mediaDescriptors`.

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- mediaIngest.test.ts`
Expected: PASS.

Also run full suite:
Run: `pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/mediaIngest.ts apps/app/src/lib/mediaIngest.test.ts apps/app/src/Canvas.tsx
git commit -m "feat(ingest): surface annotation files as descriptors"
```

---

## Task 9: `detectAnnotations` — cheap post-scan detection

**Files:**
- Create: `apps/app/src/lib/annotations/detect.ts`
- Test: `apps/app/src/lib/annotations/detect.test.ts`

Runs after the scan; walks the descriptor list (including annotation descriptors), peeks at each annotation file, and builds an `AnnotationPlan`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/detect.test.ts
import { describe, it, expect } from 'vitest';
import type { MediaDescriptor } from '../mediaIngest';
import { detectAnnotations } from './detect';

function mkDescriptor(
  relativePath: string,
  kind: MediaDescriptor['kind'],
  textOrBytes: string | Uint8Array,
): MediaDescriptor {
  const bytes =
    typeof textOrBytes === 'string'
      ? new TextEncoder().encode(textOrBytes)
      : textOrBytes;
  return {
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    size: bytes.byteLength,
    kind,
    mime: '',
    source: { type: 'zip-blob', bytes },
    load: async () => new File([bytes as BlobPart], relativePath),
  };
}

describe('detectAnnotations', () => {
  it('returns none when no annotation files are present', async () => {
    const descs = [mkDescriptor('a.jpg', 'image', new Uint8Array([0]))];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('none');
    expect(plan.totalAnnotations).toBe(0);
  });

  it('detects VOC from basename pairing', async () => {
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('a.xml', 'annotation', xml),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('voc');
    expect(plan.imagesWithAnnotations).toBe(1);
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('detects COCO via json keys and pairs by file_name', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('annotations.json', 'annotation', coco),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('detects YOLO when classes.txt and basename-paired .txt exist', async () => {
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('classes.txt', 'annotation', 'cat\ndog'),
      mkDescriptor('a.txt', 'annotation', '0 0.5 0.5 0.2 0.2'),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('yolo');
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('flags mixed when multiple formats have matches', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>dog</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('annotations.json', 'annotation', coco),
      mkDescriptor('a.xml', 'annotation', xml),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('mixed');
    expect(plan.perFormat.coco?.totalAnnotations).toBe(1);
    expect(plan.perFormat.voc?.totalAnnotations).toBe(1);
  });

  it('counts unmatched annotations when images are missing', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'missing.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const descs = [
      mkDescriptor('annotations.json', 'annotation', coco),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.imagesWithAnnotations).toBe(0);
    expect(plan.unmatchedAnnotations).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- detect.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `detectAnnotations`**

```ts
// apps/app/src/lib/annotations/detect.ts
import type { MediaDescriptor } from '../mediaIngest';
import type {
  AnnotationFormat,
  AnnotationPlan,
  AnnotationSource,
  ClassMap,
  PerFormat,
} from './types';
import { isCocoJson, cocoImageFilenames, type CocoJson } from './coco';
import { isVocXml } from './voc';
import { parseClassList } from './classMap';

const MAX_JSON_BYTES = 64 * 1024 * 1024;

const emptyPerFormat = (): PerFormat => ({
  imagesWithAnnotations: 0,
  totalAnnotations: 0,
  classes: [],
  unmatchedAnnotations: 0,
});

export async function detectAnnotations(
  descriptors: readonly MediaDescriptor[],
): Promise<AnnotationPlan> {
  const warnings: string[] = [];
  const perFormat: Partial<Record<AnnotationFormat, PerFormat>> = {};
  const sources: AnnotationSource[] = [];

  const images = descriptors.filter((d) => d.kind === 'image');
  const annotationFiles = descriptors.filter((d) => d.kind === 'annotation');

  const imagesByBasename = new Map<string, MediaDescriptor>();
  const imagesByFullPath = new Map<string, MediaDescriptor>();
  for (const img of images) {
    imagesByBasename.set(basenameNoExt(img.name).toLowerCase(), img);
    imagesByFullPath.set(img.relativePath, img);
  }

  // --- Find class-list files (YOLO). ---
  let classMap: ClassMap | null = null;
  for (const f of annotationFiles) {
    const leaf = f.name.toLowerCase();
    const isClassList =
      leaf === 'classes.txt' ||
      leaf === 'obj.names' ||
      leaf === 'data.yaml' ||
      leaf === 'data.yml';
    if (!isClassList) continue;
    const text = await readAsText(f);
    const parsed = parseClassList(text, f.relativePath);
    if (parsed.names.length > 0 && !classMap) classMap = parsed;
  }

  // --- Walk annotation files and classify each. ---
  for (const f of annotationFiles) {
    const ext = extname(f.name);
    const leaf = f.name.toLowerCase();
    if (leaf === 'classes.txt' || leaf === 'obj.names' || leaf === 'data.yaml' || leaf === 'data.yml') continue;

    if (ext === 'json') {
      if (f.size > MAX_JSON_BYTES) {
        warnings.push(`Skipped ${f.relativePath}: JSON > 64 MB`);
        continue;
      }
      const text = await readAsText(f);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        warnings.push(`Skipped ${f.relativePath}: invalid JSON`);
        continue;
      }
      if (!isCocoJson(parsed)) continue;
      const coco = parsed as CocoJson;
      const bucket = (perFormat.coco ??= emptyPerFormat());
      const classes = coco.categories.map((c) => c.name);
      bucket.classes = uniqueLower([...bucket.classes, ...classes]);
      const fnames = cocoImageFilenames(coco);
      let matched = 0;
      for (const fn of fnames) {
        if (findImage(imagesByFullPath, imagesByBasename, fn)) matched++;
      }
      bucket.imagesWithAnnotations += matched;
      bucket.totalAnnotations += coco.annotations.length;
      bucket.unmatchedAnnotations += coco.annotations.length - countAnnotationsForMatchedImages(coco, imagesByFullPath, imagesByBasename);
      sources.push({
        format: 'coco',
        classes,
        descriptor: {
          relativePath: f.relativePath,
          load: async () => readAsText(f),
        },
      });
      continue;
    }

    if (ext === 'xml') {
      const text = await readAsText(f);
      if (!isVocXml(text)) continue;
      const paired = findImage(imagesByFullPath, imagesByBasename, f.relativePath);
      const bucket = (perFormat.voc ??= emptyPerFormat());
      const classes = extractVocClassNames(text);
      bucket.classes = uniqueLower([...bucket.classes, ...classes]);
      if (paired) {
        bucket.imagesWithAnnotations += 1;
        bucket.totalAnnotations += classes.length;
        sources.push({
          format: 'voc',
          imageDescriptorPath: paired.relativePath,
          descriptor: {
            relativePath: f.relativePath,
            load: async () => text,
          },
        });
      } else {
        bucket.unmatchedAnnotations += classes.length;
      }
      continue;
    }

    if (ext === 'txt') {
      const paired = findImage(imagesByFullPath, imagesByBasename, f.relativePath);
      if (!paired) continue;
      const bucket = (perFormat.yolo ??= emptyPerFormat());
      const text = await readAsText(f);
      const lineCount = text.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.trim().startsWith('#')).length;
      const classes = classMap?.names ?? [];
      bucket.classes = uniqueLower([...bucket.classes, ...classes]);
      bucket.imagesWithAnnotations += 1;
      bucket.totalAnnotations += lineCount;
      sources.push({
        format: 'yolo',
        classMap: classMap ?? { names: [] },
        imageDescriptorPath: paired.relativePath,
        descriptor: {
          relativePath: f.relativePath,
          load: async () => text,
        },
      });
      continue;
    }
  }

  if (!classMap && perFormat.yolo) {
    warnings.push('YOLO labels found but no class list (data.yaml / classes.txt / obj.names). Classes will be named class_0, class_1, …');
  }

  const nonZero = (Object.keys(perFormat) as AnnotationFormat[]).filter(
    (k) => (perFormat[k]?.totalAnnotations ?? 0) > 0,
  );
  const format: AnnotationPlan['format'] =
    nonZero.length === 0 ? 'none' : nonZero.length === 1 ? nonZero[0]! : 'mixed';

  const classes = uniqueLower(Object.values(perFormat).flatMap((pf) => pf?.classes ?? []));

  return {
    format,
    perFormat,
    classes,
    imagesWithAnnotations: sum(Object.values(perFormat).map((pf) => pf?.imagesWithAnnotations ?? 0)),
    totalAnnotations: sum(Object.values(perFormat).map((pf) => pf?.totalAnnotations ?? 0)),
    unmatchedAnnotations: sum(Object.values(perFormat).map((pf) => pf?.unmatchedAnnotations ?? 0)),
    warnings,
    sources,
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function extname(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function basenameNoExt(name: string): string {
  const leaf = name.split('/').pop() ?? name;
  const dot = leaf.lastIndexOf('.');
  return dot < 0 ? leaf : leaf.slice(0, dot);
}

async function readAsText(descriptor: MediaDescriptor): Promise<string> {
  const file = await descriptor.load();
  return await file.text();
}

function uniqueLower(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.toLowerCase())));
}

function findImage(
  byPath: Map<string, MediaDescriptor>,
  byBasename: Map<string, MediaDescriptor>,
  reference: string,
): MediaDescriptor | null {
  return (
    byPath.get(reference) ??
    byBasename.get(basenameNoExt(reference).toLowerCase()) ??
    null
  );
}

function countAnnotationsForMatchedImages(
  coco: CocoJson,
  byPath: Map<string, MediaDescriptor>,
  byBasename: Map<string, MediaDescriptor>,
): number {
  const matchedIds = new Set<number>();
  for (const img of coco.images) {
    if (findImage(byPath, byBasename, img.file_name)) matchedIds.add(img.id);
  }
  return coco.annotations.filter((a) => matchedIds.has(a.image_id)).length;
}

function extractVocClassNames(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<object>([\s\S]*?)<\/object>/g)) {
    const name = m[1]!.match(/<name>\s*([^<]+?)\s*<\/name>/);
    if (name) out.push(name[1]!);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @netrart/app test -- detect.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Re-export from the barrel**

Append to `apps/app/src/lib/annotations/index.ts`:

```ts
export { detectAnnotations } from './detect';
```

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/annotations/detect.ts apps/app/src/lib/annotations/detect.test.ts apps/app/src/lib/annotations/index.ts
git commit -m "feat(annotations): add detectAnnotations post-scan pass"
```

---

## Task 10: Extend `ScanEvent` & `useImportPreview` with annotation state

**Files:**
- Modify: `apps/app/src/hooks/useImportPreview.ts`

Detection runs once after the scan yields `done`. We stash the `AnnotationPlan` in preview state for the modal.

- [ ] **Step 1: Update `ImportState`**

Replace the `ImportState` type and `EMPTY`:

```ts
import type { AnnotationPlan, AnnotationFormat } from '../lib/annotations';

export type ImportState = {
  open: boolean;
  phase: 'scanning' | 'detecting' | 'ready' | 'error';
  descriptors: MediaDescriptor[];
  bytes: number;
  imageCount: number;
  videoCount: number;
  annotationCount: number;
  warning?: { code: 'cap-soft'; message: string };
  error?: {
    code: 'cap-hard' | 'cap-depth' | 'zip-malformed' | 'scan-failed' | 'aborted';
    message: string;
  };
  sourceLabel: string;
  annotationPlan: AnnotationPlan | null;
  /** When format === 'mixed', the user picks one here; otherwise mirrors
   *  annotationPlan.format. */
  chosenFormat: AnnotationFormat | 'none';
};

const EMPTY: ImportState = {
  open: false,
  phase: 'ready',
  descriptors: [],
  bytes: 0,
  imageCount: 0,
  videoCount: 0,
  annotationCount: 0,
  sourceLabel: '',
  annotationPlan: null,
  chosenFormat: 'none',
};
```

- [ ] **Step 2: Accumulate annotation descriptors**

Update `applyEvent` to count `kind === 'annotation'` into `annotationCount`:

```ts
case 'descriptor': {
  const d = event.descriptor;
  return {
    ...prev,
    descriptors: [...prev.descriptors, d],
    bytes: prev.bytes + d.size,
    imageCount: prev.imageCount + (d.kind === 'image' ? 1 : 0),
    videoCount: prev.videoCount + (d.kind === 'video' ? 1 : 0),
    annotationCount: prev.annotationCount + (d.kind === 'annotation' ? 1 : 0),
  };
}
```

Update the `done` case to move into `detecting` phase rather than `ready` directly:

```ts
case 'done':
  return { ...prev, phase: 'detecting' };
```

- [ ] **Step 3: Run `detectAnnotations` after scan completion**

Modify `start` to accumulate descriptors locally during the scan and pass them to detection:

```ts
import { detectAnnotations } from '../lib/annotations';

// inside start():
const accumulated: MediaDescriptor[] = [];
let sawScanError = false;

try {
  for await (const event of gen) {
    if (controller.signal.aborted) return;
    if (event.type === 'descriptor') accumulated.push(event.descriptor);
    if (event.type === 'error') sawScanError = true;
    setState((prev) => applyEvent(prev, event));
  }
} catch (err) {
  if (controller.signal.aborted) return;
  setState((prev) => ({
    ...prev,
    phase: 'error',
    error: {
      code: 'scan-failed',
      message: (err as Error).message || 'scan failed',
    },
  }));
  return;
}

if (sawScanError) return; // applyEvent already set phase → 'error'.

try {
  const plan = await detectAnnotations(accumulated);
  if (controller.signal.aborted) return;
  setState((prev) => ({
    ...prev,
    phase: 'ready',
    annotationPlan: plan,
    chosenFormat: plan.format === 'mixed' ? 'none' : plan.format,
  }));
} catch (err) {
  if (controller.signal.aborted) return;
  setState((prev) => ({
    ...prev,
    phase: 'error',
    error: {
      code: 'scan-failed',
      message: (err as Error).message || 'annotation detection failed',
    },
  }));
}
```

- [ ] **Step 4: Add a `setChosenFormat` action**

Append to the hook's return value:

```ts
const setChosenFormat = useCallback((f: AnnotationFormat | 'none') => {
  setState((prev) => ({ ...prev, chosenFormat: f }));
}, []);

return { state, start, cancel, close, setPendingPoint, getPendingPoint, setChosenFormat };
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/hooks/useImportPreview.ts
git commit -m "feat(import-preview): detect annotations after scan completes"
```

---

## Task 11: Annotation panel in `ImportPreviewModal`

**Files:**
- Modify: `apps/app/src/components/ImportPreviewModal.tsx`

Adds a "Detected annotations" block under the summary. Shows format, image/annotation/class counts, warnings; format picker when `mixed`.

- [ ] **Step 1: Extend props to accept format picker callback**

```tsx
import type { AnnotationFormat } from '../lib/annotations';

type Props = {
  state: ImportState;
  onCancel: () => void;
  onImport: () => void;
  onChangeFormat: (f: AnnotationFormat | 'none') => void;
};

export function ImportPreviewModal({ state, onCancel, onImport, onChangeFormat }: Props) {
  // ...
}
```

- [ ] **Step 2: Gate the import button on format choice**

Update `canImport`:

```ts
function canImport(state: ImportState): boolean {
  if (state.phase !== 'ready') return false;
  if (state.error) return false;
  if (state.descriptors.length === 0) return false;
  if (state.annotationPlan?.format === 'mixed' && state.chosenFormat === 'none') return false;
  return true;
}
```

- [ ] **Step 3: Render the panel**

Add after the `summary` div, before the warning banner:

```tsx
{state.annotationPlan && state.annotationPlan.format !== 'none' && (
  <div className="import-preview-annotations">
    <div className="import-preview-annotations-header">
      <i className="ri-price-tag-3-line" aria-hidden />
      <span>
        Detected {state.annotationPlan.format === 'mixed'
          ? 'multiple annotation formats'
          : `${state.annotationPlan.format.toUpperCase()} annotations`}
      </span>
    </div>
    <div className="import-preview-annotations-body">
      <div>{state.annotationPlan.imagesWithAnnotations} images annotated</div>
      <div>{state.annotationPlan.totalAnnotations} annotations</div>
      <div>{state.annotationPlan.classes.length} classes</div>
      {state.annotationPlan.unmatchedAnnotations > 0 && (
        <div>{state.annotationPlan.unmatchedAnnotations} annotations with no matching image (will be skipped)</div>
      )}
    </div>
    {state.annotationPlan.format === 'mixed' && (
      <div className="import-preview-annotations-picker">
        <label htmlFor="annotation-format-picker">Import as:</label>
        <select
          id="annotation-format-picker"
          value={state.chosenFormat}
          onChange={(e) => onChangeFormat(e.target.value as AnnotationFormat | 'none')}
        >
          <option value="none">Pick a format…</option>
          {(['coco', 'yolo', 'voc'] as const).map((f) =>
            state.annotationPlan!.perFormat[f] ? (
              <option key={f} value={f}>
                {f.toUpperCase()} ({state.annotationPlan!.perFormat[f]!.totalAnnotations} annotations)
              </option>
            ) : null,
          )}
        </select>
      </div>
    )}
    {state.annotationPlan.warnings.map((w, i) => (
      <div key={i} className="import-preview-banner is-warning" role="alert">
        <i className="ri-alert-line" aria-hidden />
        <span>{w}</span>
      </div>
    ))}
  </div>
)}
```

Also update the `summary` computed string to mention annotations when present:

```tsx
const total = state.imageCount + state.videoCount;
const summary =
  state.phase === 'scanning' && total === 0
    ? 'Scanning…'
    : state.phase === 'detecting'
      ? `${state.imageCount} images · ${state.videoCount} videos — detecting annotations…`
      : `${state.imageCount} images · ${state.videoCount} videos · ${humanSize(state.bytes)}`;
```

And update the "Scanning…" button label:

```tsx
{state.phase === 'scanning' ? 'Scanning…' : state.phase === 'detecting' ? 'Detecting…' : 'Import'}
```

- [ ] **Step 4: Add matching CSS**

Append to `apps/app/src/App.css` (find the nearest `.import-preview-*` block):

```css
.import-preview-annotations {
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.import-preview-annotations-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.import-preview-annotations-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted, rgba(255,255,255,0.7));
}

.import-preview-annotations-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 5: Wire the new prop at the call site**

In `apps/app/src/Canvas.tsx`, find the `<ImportPreviewModal` usage (around line 3390) and add `onChangeFormat={preview.setChosenFormat}`:

```tsx
<ImportPreviewModal
  state={preview.state}
  onCancel={preview.cancel}
  onImport={onConfirmImport}
  onChangeFormat={preview.setChosenFormat}
/>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/components/ImportPreviewModal.tsx apps/app/src/App.css apps/app/src/Canvas.tsx
git commit -m "feat(import-preview): render annotation detection panel"
```

---

## Task 12: Return `imageIdByDescriptor` from `runUploadPlan`

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

`runAnnotationPlan` needs the PB image IDs keyed by the descriptor that produced each upload. The current `runUploadPlan` returns `Promise<void>` and stores results in state. Add a side-channel map so the caller can await IDs.

- [ ] **Step 1: Add a descriptor → draft id → image id map**

Find `importDescriptors` in `Canvas.tsx` (around line 1965). Build a `descriptorByDraftId` map alongside the upload plan:

```ts
const plan: UploadPlan[] = loaded.map((l, i) => {
  const r = placements[i]!;
  const meta = {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    name: l.file.name,
  };
  return {
    draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
    file: l.file,
    meta,
  };
});

// NEW: align plan entries back to their source descriptors (same order as
// mediaDescriptors above, after filtering).
const descriptorByDraftId = new Map<string, MediaDescriptor>();
for (let i = 0; i < plan.length; i++) {
  descriptorByDraftId.set(plan[i]!.draft.id, mediaDescriptors[i]!);
}
```

- [ ] **Step 2: Widen `runUploadPlan` to accept a result-collector callback**

Update the `runUploadPlan` signature and implementation:

```ts
const runUploadPlan = useCallback(
  (
    plan: UploadPlan[],
    onUploaded?: (draftId: string, record: ImageRecord | VideoRecord) => void,
  ): Promise<void> => {
    // ... existing body unchanged, except after the record is assigned:
    //   `const record = ...`
    //   add:
    //   if (onUploaded) onUploaded(p.draft.id, record);
  },
  [sam3Available, history],
);
```

Inside the try block in `runUploadPlan`, right after `const record = p.draft.kind === 'video' ? await createVideo(...) : await createImage(...)`, add:

```ts
if (onUploaded) onUploaded(p.draft.id, record);
```

- [ ] **Step 3: Collect image records in `importDescriptors`**

In `importDescriptors`, capture image records as they land. `ImageRecord` and `VideoRecord` both derive from `PlacementRecordSchema` and both carry `.id`, so we just read it directly:

```ts
const imageIdByDescriptorPath = new Map<string, string>();
const onUploaded = (draftId: string, record: ImageRecord | VideoRecord) => {
  const desc = descriptorByDraftId.get(draftId);
  if (desc && desc.kind === 'image') {
    imageIdByDescriptorPath.set(desc.relativePath, record.id);
  }
};

const uploading = runUploadPlan(plan, onUploaded);
// ... after: await uploading;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(canvas): surface imageId→descriptor map during upload"
```

---

## Task 13: `runAnnotationPlan` — parse, rasterize, upsert

**Files:**
- Create: `apps/app/src/lib/annotations/runAnnotationPlan.ts`
- Test: `apps/app/src/lib/annotations/runAnnotationPlan.test.ts`
- Modify: `apps/app/src/Canvas.tsx`

Produces the `SegMask[]` groups and calls `upsertSegmentation`. Logic is extracted so it's testable in node with a mocked upsert.

- [ ] **Step 1: Write failing tests**

```ts
// apps/app/src/lib/annotations/runAnnotationPlan.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSegMaskGroups } from './runAnnotationPlan';
import type { ParsedAnnotation } from './types';

describe('buildSegMaskGroups', () => {
  it('groups annotations by (imageId, className) and lowercases className', async () => {
    const annotations: Array<{ imageId: string; annotation: ParsedAnnotation }> = [
      {
        imageId: 'img1',
        annotation: {
          className: 'Cat',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [0, 0, 5, 5],
          geometry: { kind: 'bbox' },
        },
      },
      {
        imageId: 'img1',
        annotation: {
          className: 'cat',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [5, 5, 10, 10],
          geometry: { kind: 'bbox' },
        },
      },
      {
        imageId: 'img1',
        annotation: {
          className: 'dog',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [0, 0, 3, 3],
          geometry: { kind: 'bbox' },
        },
      },
    ];

    const encode = vi.fn(async () => 'AAA');
    const groups = await buildSegMaskGroups(annotations, encode);
    expect(groups).toHaveLength(2);
    const catGroup = groups.find((g) => g.tag === 'cat')!;
    expect(catGroup.imageId).toBe('img1');
    expect(catGroup.masks).toHaveLength(2);
    expect(catGroup.masks[0]!.bbox).toEqual([0, 0, 5, 5]);
    expect(catGroup.masks[0]!.score).toBe(1);
    expect(catGroup.masks[0]!.png_base64).toBe('AAA');
    expect(encode).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netrart/app test -- runAnnotationPlan.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement extractable logic**

```ts
// apps/app/src/lib/annotations/runAnnotationPlan.ts
import type { SegMask } from '../segmentations';
import type { ParsedAnnotation, AnnotationPlan, AnnotationSource, AnnotationFormat } from './types';
import type { MediaDescriptor } from '../mediaIngest';
import { geometryToMaskBytes, maskBytesToPngBase64 } from './rasterize';
import { parseCoco, type CocoJson } from './coco';
import { parseVoc } from './voc';
import { parseYolo } from './yolo';

export type SegGroup = {
  imageId: string;
  tag: string;
  masks: SegMask[];
  sourceWidth: number;
  sourceHeight: number;
};

export type Encoder = (annotation: ParsedAnnotation) => Promise<string>;

/** Pure grouping: annotations → SegGroup[]. Encoder stubbed in tests. */
export async function buildSegMaskGroups(
  annotations: Array<{ imageId: string; annotation: ParsedAnnotation }>,
  encode: Encoder,
): Promise<SegGroup[]> {
  const byKey = new Map<string, SegGroup>();
  for (const { imageId, annotation } of annotations) {
    const tag = annotation.className.toLowerCase();
    const key = `${imageId}::${tag}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        imageId,
        tag,
        masks: [],
        sourceWidth: annotation.imageWidth,
        sourceHeight: annotation.imageHeight,
      };
      byKey.set(key, group);
    }
    const png_base64 = await encode(annotation);
    group.masks.push({
      png_base64,
      width: annotation.imageWidth,
      height: annotation.imageHeight,
      score: 1,
      bbox: annotation.bbox,
    });
  }
  return Array.from(byKey.values());
}

export type RunAnnotationPlanInput = {
  plan: AnnotationPlan;
  chosenFormat: AnnotationFormat | 'none';
  descriptors: readonly MediaDescriptor[];
  imageIdByDescriptorPath: ReadonlyMap<string, string>;
  upsert: (group: SegGroup) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
};

export async function runAnnotationPlan(input: RunAnnotationPlanInput): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  const sources = input.plan.sources.filter((s) =>
    input.chosenFormat === 'none' ? true : s.format === input.chosenFormat,
  );

  const annotations: Array<{ imageId: string; annotation: ParsedAnnotation }> = [];

  for (const source of sources) {
    try {
      const parsed = await parseSource(source, input.descriptors);
      for (const { imageDescriptorPath, annotation } of parsed) {
        const imageId = input.imageIdByDescriptorPath.get(imageDescriptorPath);
        if (!imageId) continue;
        annotations.push({ imageId, annotation });
      }
    } catch (err) {
      errors.push(`${source.descriptor.relativePath}: ${(err as Error).message}`);
    }
  }

  const encode: Encoder = async (annotation) => {
    const bytes = geometryToMaskBytes(
      annotation.geometry,
      { width: annotation.imageWidth, height: annotation.imageHeight },
      { bbox: annotation.bbox },
    );
    return maskBytesToPngBase64(bytes, {
      width: annotation.imageWidth,
      height: annotation.imageHeight,
    });
  };

  const groups = await buildSegMaskGroups(annotations, encode);
  let done = 0;
  for (const group of groups) {
    try {
      await input.upsert(group);
      done++;
      input.onProgress?.(done, groups.length);
    } catch (err) {
      errors.push(`${group.imageId}/${group.tag}: ${(err as Error).message}`);
    }
  }
  return { imported: done, skipped: annotations.length - done, errors };
}

async function parseSource(
  source: AnnotationSource,
  descriptors: readonly MediaDescriptor[],
): Promise<Array<{ imageDescriptorPath: string; annotation: ParsedAnnotation }>> {
  if (source.format === 'coco') {
    const text = await source.descriptor.load();
    const json = JSON.parse(text) as CocoJson;

    const byBasename = new Map<string, MediaDescriptor>();
    const byPath = new Map<string, MediaDescriptor>();
    for (const d of descriptors) {
      if (d.kind !== 'image') continue;
      byPath.set(d.relativePath, d);
      byBasename.set(stripExt(d.name).toLowerCase(), d);
    }
    const imageDescPathByCocoId = new Map<number, string>();
    for (const img of json.images) {
      const leaf = img.file_name.split('/').pop() ?? img.file_name;
      const match = byPath.get(img.file_name) ?? byBasename.get(stripExt(leaf).toLowerCase());
      if (match) imageDescPathByCocoId.set(img.id, match.relativePath);
    }

    const out: Array<{ imageDescriptorPath: string; annotation: ParsedAnnotation }> = [];
    for (const { imageId, annotation } of parseCoco(json)) {
      const imageDescPath = imageDescPathByCocoId.get(imageId);
      if (!imageDescPath) continue;
      out.push({ imageDescriptorPath: imageDescPath, annotation });
    }
    return out;
  }

  if (source.format === 'voc') {
    const text = await source.descriptor.load();
    return parseVoc(text).map((annotation) => ({
      imageDescriptorPath: source.imageDescriptorPath,
      annotation,
    }));
  }

  if (source.format === 'yolo') {
    const text = await source.descriptor.load();
    const imgDesc = descriptors.find((d) => d.relativePath === source.imageDescriptorPath);
    if (!imgDesc) return [];
    const file = await imgDesc.load();
    const bitmap = await createImageBitmap(file);
    try {
      return parseYolo(text, source.classMap, {
        width: bitmap.width,
        height: bitmap.height,
      }).map((annotation) => ({
        imageDescriptorPath: source.imageDescriptorPath,
        annotation,
      }));
    } finally {
      bitmap.close?.();
    }
  }

  return [];
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @netrart/app test -- runAnnotationPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-export from the barrel**

Append to `apps/app/src/lib/annotations/index.ts`:

```ts
export { runAnnotationPlan, buildSegMaskGroups } from './runAnnotationPlan';
export type { SegGroup } from './runAnnotationPlan';
```

- [ ] **Step 6: Wire into `importDescriptors`**

In `apps/app/src/Canvas.tsx`, after the `await uploading;` line, before the function closes:

```ts
if (annotationPlan && chosenFormat !== 'none' && chosenFormat !== 'mixed') {
  try {
    const { errors } = await runAnnotationPlan({
      plan: annotationPlan,
      chosenFormat,
      descriptors,
      imageIdByDescriptorPath,
      upsert: (group) =>
        upsertSegmentation({
          image: group.imageId,
          tag: group.tag,
          masks: group.masks,
          source_width: group.sourceWidth,
          source_height: group.sourceHeight,
        }).then(() => undefined),
    });
    if (errors.length > 0) console.warn('[annotations] errors:', errors);
  } catch (err) {
    console.error('[annotations] plan failed', err);
  }
}
```

This means `importDescriptors` now needs to accept the plan + chosen format as arguments:

```ts
const importDescriptors = useCallback(
  async (
    descriptors: MediaDescriptor[],
    point: WorldPoint,
    annotationPlan: AnnotationPlan | null = null,
    chosenFormat: AnnotationFormat | 'none' = 'none',
  ) => {
    // ...
  },
  [runUploadPlan],
);
```

And update the two call sites:
- `handleDrop` fast path — pass `null, 'none'`.
- `onConfirmImport` — pass `preview.state.annotationPlan, preview.state.chosenFormat`.

- [ ] **Step 7: Typecheck and run full tests**

Run: `pnpm --filter @netrart/app typecheck && pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/lib/annotations/runAnnotationPlan.ts \
        apps/app/src/lib/annotations/runAnnotationPlan.test.ts \
        apps/app/src/lib/annotations/index.ts \
        apps/app/src/Canvas.tsx
git commit -m "feat(annotations): parse, rasterize, and upsert on import"
```

---

## Task 14: Fixture-backed detection integration test

**Files:**
- Create: `apps/app/src/lib/annotations/detect.integration.test.ts`

Builds real zip bytes in-memory, runs through `extractZipRecursive` + `detectAnnotations`, asserts the plan end-to-end.

- [ ] **Step 1: Write the test**

```ts
// apps/app/src/lib/annotations/detect.integration.test.ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractZipRecursive } from '../mediaIngest';
import { detectAnnotations } from './detect';

const tinyPng = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

describe('detectAnnotations integration — COCO in zip', () => {
  it('detects COCO annotations and pairs images by file_name', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [
        { image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] },
        { image_id: 1, category_id: 2, bbox: [5, 5, 10, 10] },
      ],
      categories: [
        { id: 1, name: 'cat' },
        { id: 2, name: 'dog' },
      ],
    });
    const zip = zipSync({
      'images/a.jpg': tinyPng(),
      'annotations/instances.json': strToU8(coco),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.totalAnnotations).toBe(2);
    expect(plan.imagesWithAnnotations).toBe(1);
    expect(plan.classes.sort()).toEqual(['cat', 'dog']);
  });
});

describe('detectAnnotations integration — YOLO in zip', () => {
  it('detects YOLO labels with data.yaml class list', async () => {
    const zip = zipSync({
      'images/a.jpg': tinyPng(),
      'labels/a.txt': strToU8('0 0.5 0.5 0.2 0.2\n1 0.3 0.3 0.1 0.1\n'),
      'data.yaml': strToU8('names: [cat, dog]\n'),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('yolo');
    expect(plan.totalAnnotations).toBe(2);
    expect(plan.classes.sort()).toEqual(['cat', 'dog']);
  });
});

describe('detectAnnotations integration — VOC in zip', () => {
  it('detects VOC via per-image XML pairing', async () => {
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const zip = zipSync({
      'JPEGImages/a.jpg': tinyPng(),
      'Annotations/a.xml': strToU8(xml),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('voc');
    expect(plan.totalAnnotations).toBe(1);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @netrart/app test -- detect.integration.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/annotations/detect.integration.test.ts
git commit -m "test(annotations): integration detection through zip pipeline"
```

---

## Task 15: Manual end-to-end verification + final commit

**Files:**
- Create: `apps/app/src/lib/annotations/test-plan.md`

- [ ] **Step 1: Write the manual test plan**

```markdown
# Annotation Import — Manual Test Plan

## Setup
- Run `pnpm --filter @netrart/app tauri:dev`.
- Start PocketBase: `pnpm --filter @netrart/app stage:pb` then run the binary per README.

## Fixtures
Prepare three small datasets (3–5 images each):
- **COCO**: folder with `images/*.jpg` + `annotations/instances.json`. Include at least one bbox-only, one polygon, and one RLE annotation.
- **YOLO**: folder with `images/*.jpg`, `labels/*.txt`, and `data.yaml`. Include one bbox-only row and one polygon row.
- **VOC**: folder with `JPEGImages/*.jpg` + `Annotations/*.xml`.

## Cases

### COCO zip
1. Zip the COCO folder, drag onto the canvas.
2. Confirm preview modal shows: "Detected COCO annotations", correct image/annotation/class counts.
3. Confirm "Import" proceeds. Wait for upload to finish.
4. Confirm tags appear on the imported images and masks match the annotation shapes (rectangle for bbox, roughly polygon shape for polygon, RLE shape for RLE).

### YOLO folder
1. Drag the YOLO folder (not zipped) onto the canvas.
2. Confirm preview modal shows "Detected YOLO annotations" with the right class count.
3. Import. Verify tags + bbox/polygon masks.

### VOC zip
1. Zip the VOC folder, drag onto the canvas.
2. Confirm "Detected VOC annotations" with the right counts.
3. Import. Verify bbox masks on each image.

### Mixed zip
1. Zip one with both VOC XML and YOLO txts for the same images.
2. Confirm the preview modal shows the mixed selector; "Import" is disabled until a format is chosen.
3. Pick VOC, import. Verify only VOC annotations materialize.

### No-annotation fallback
1. Zip a plain folder of images (no sidecar files).
2. Confirm no annotation panel appears.
3. Import flow matches current behavior.
```

- [ ] **Step 2: Run full test suite + typecheck**

Run: `pnpm --filter @netrart/app typecheck && pnpm --filter @netrart/app test`
Expected: PASS.

- [ ] **Step 3: Run through the manual cases**

Execute each case above. Note any mismatch between detected counts and actual annotations (these point to parser bugs). Fix issues inline and re-commit before proceeding.

- [ ] **Step 4: Final commit**

```bash
git add apps/app/src/lib/annotations/test-plan.md
git commit -m "docs(annotations): add manual e2e test plan"
```

---

## Completion criteria

All of the following must be true before declaring this plan complete:

1. `pnpm --filter @netrart/app test` passes.
2. `pnpm --filter @netrart/app typecheck` passes.
3. Dropping a COCO zip, a YOLO folder, and a VOC zip each produces an import-preview modal with the correct format badge + counts.
4. After confirming import, the resulting images on the canvas carry the expected tags and visible masks matching the source geometry.
5. A plain-images drop still imports with no annotation panel and no behavioral regression.
