export type AnnotationFormat = 'coco' | 'yolo' | 'voc';

export type ParsedAnnotation = {
  className: string;
  imageWidth: number;
  imageHeight: number;
  /** Pixel-space [x1, y1, x2, y2]; derived from geometry bounds if source is geometry-only. */
  bbox: [number, number, number, number];
  geometry: Geometry;
};

export type Geometry =
  | { kind: 'bbox' }
  | { kind: 'polygon'; rings: number[][] }
  | { kind: 'rle'; counts: number[]; height: number; width: number };

export type ClassMap = {
  /** `names[i]` is the display name for class index i (YOLO). */
  names: string[];
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
  perFormat: Partial<Record<AnnotationFormat, PerFormat>>;
  /** Union across detected formats, deduped + lowercased. */
  classes: string[];
  imagesWithAnnotations: number;
  totalAnnotations: number;
  unmatchedAnnotations: number;
  warnings: string[];
  /** Filtered to the chosen format after modal confirm when format === 'mixed'. */
  sources: AnnotationSource[];
};

export type PerFormat = {
  imagesWithAnnotations: number;
  totalAnnotations: number;
  classes: string[];
  unmatchedAnnotations: number;
};
