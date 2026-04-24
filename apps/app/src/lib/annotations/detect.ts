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

  for (const f of annotationFiles) {
    const ext = extname(f.name);
    const leaf = f.name.toLowerCase();
    if (
      leaf === 'classes.txt' ||
      leaf === 'obj.names' ||
      leaf === 'data.yaml' ||
      leaf === 'data.yml'
    ) continue;

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
      let matchedImages = 0;
      for (const fn of fnames) {
        if (findImage(imagesByFullPath, imagesByBasename, fn)) matchedImages++;
      }
      bucket.imagesWithAnnotations += matchedImages;
      bucket.totalAnnotations += coco.annotations.length;
      const matchedAnns = countAnnotationsForMatchedImages(
        coco,
        imagesByFullPath,
        imagesByBasename,
      );
      bucket.unmatchedAnnotations += coco.annotations.length - matchedAnns;
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
      const lines = text
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
      const lineCount = lines.length;
      const usedClassNames = resolveYoloClasses(lines, classMap);
      bucket.classes = uniqueLower([...bucket.classes, ...usedClassNames]);
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
    warnings.push(
      'YOLO labels found but no class list (data.yaml / classes.txt / obj.names). Classes will be named class_0, class_1, …',
    );
  }

  const nonZero = (Object.keys(perFormat) as AnnotationFormat[]).filter(
    (k) => (perFormat[k]?.totalAnnotations ?? 0) > 0,
  );
  const format: AnnotationPlan['format'] =
    nonZero.length === 0 ? 'none' : nonZero.length === 1 ? nonZero[0]! : 'mixed';

  const classes = uniqueLower(
    Object.values(perFormat).flatMap((pf) => pf?.classes ?? []),
  );

  return {
    format,
    perFormat,
    classes,
    imagesWithAnnotations: sum(
      Object.values(perFormat).map((pf) => pf?.imagesWithAnnotations ?? 0),
    ),
    totalAnnotations: sum(
      Object.values(perFormat).map((pf) => pf?.totalAnnotations ?? 0),
    ),
    unmatchedAnnotations: sum(
      Object.values(perFormat).map((pf) => pf?.unmatchedAnnotations ?? 0),
    ),
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
  return file.text();
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

function resolveYoloClasses(lines: string[], classMap: ClassMap | null): string[] {
  const usedIndices = new Set<number>();
  for (const line of lines) {
    const idx = parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
    if (!Number.isNaN(idx)) usedIndices.add(idx);
  }
  if (!classMap) return [];
  const out: string[] = [];
  for (const idx of usedIndices) {
    const name = classMap.names[idx];
    if (name) out.push(name);
  }
  return out;
}

function extractVocClassNames(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<object>([\s\S]*?)<\/object>/g)) {
    const name = m[1]!.match(/<name>\s*([^<]+?)\s*<\/name>/);
    if (name) out.push(name[1]!);
  }
  return out;
}
