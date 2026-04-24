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
