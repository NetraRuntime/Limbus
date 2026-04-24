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
export { detectAnnotations } from './detect';
export { runAnnotationPlan, buildSegMaskGroups } from './runAnnotationPlan';
export type { SegGroup } from './runAnnotationPlan';
