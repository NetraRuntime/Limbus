import type { SegMask } from '../segmentations';
import type { MediaDescriptor } from '../mediaIngest';
import type {
  AnnotationPlan,
  AnnotationSource,
  AnnotationFormat,
  ParsedAnnotation,
} from './types';
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

const YIELD_EVERY = 16;

export async function buildSegMaskGroups(
  annotations: Array<{ imageId: string; annotation: ParsedAnnotation }>,
  encode: Encoder,
  onEncoded?: (done: number, total: number) => void,
): Promise<SegGroup[]> {
  const byKey = new Map<string, SegGroup>();
  let doneEncoding = 0;
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
    doneEncoding++;
    onEncoded?.(doneEncoding, annotations.length);
    if (doneEncoding % YIELD_EVERY === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return Array.from(byKey.values());
}

export type RunAnnotationPlanResult = {
  /** Individual ParsedAnnotations that made it into a successfully upserted group. */
  annotationsImported: number;
  /** Annotations whose image had no PocketBase id — skipped before grouping. */
  annotationsUnmatched: number;
  /** Successfully upserted (imageId, tag) groups. */
  groupsImported: number;
  /** Groups whose upsert threw — their annotations are NOT counted in annotationsImported. */
  groupsFailed: number;
  errors: string[];
};

export type RunAnnotationPlanInput = {
  plan: AnnotationPlan;
  chosenFormat: AnnotationFormat | 'none';
  descriptors: readonly MediaDescriptor[];
  imageIdByDescriptorPath: ReadonlyMap<string, string>;
  upsert: (group: SegGroup) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  onEncodeProgress?: (done: number, total: number) => void;
};

export async function runAnnotationPlan(
  input: RunAnnotationPlanInput,
): Promise<RunAnnotationPlanResult> {
  const errors: string[] = [];
  const sources = input.plan.sources.filter((s) =>
    input.chosenFormat === 'none' ? true : s.format === input.chosenFormat,
  );

  const annotations: Array<{ imageId: string; annotation: ParsedAnnotation }> = [];
  let annotationsUnmatched = 0;

  for (const source of sources) {
    try {
      const parsed = await parseSource(source, input.descriptors);
      for (const { imageDescriptorPath, annotation } of parsed) {
        const imageId = input.imageIdByDescriptorPath.get(imageDescriptorPath);
        if (!imageId) {
          annotationsUnmatched++;
          continue;
        }
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

  const groups = await buildSegMaskGroups(annotations, encode, input.onEncodeProgress);

  let groupsImported = 0;
  let groupsFailed = 0;
  let annotationsImported = 0;

  for (const group of groups) {
    try {
      await input.upsert(group);
      groupsImported++;
      annotationsImported += group.masks.length;
      input.onProgress?.(groupsImported, groups.length);
    } catch (err) {
      groupsFailed++;
      errors.push(`${group.imageId}/${group.tag}: ${(err as Error).message}`);
    }
  }

  return { annotationsImported, annotationsUnmatched, groupsImported, groupsFailed, errors };
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
