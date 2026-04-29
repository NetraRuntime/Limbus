import type { MediaKind } from '../../../lib/pb';

export type CanvasMedia = {
  id: string;
  kind: MediaKind;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pending?: boolean;
  collectionId?: string;
  file?: string;
};

export type ConnState = 'connecting' | 'ready' | 'offline';

export type DragOrig = { x: number; y: number; kind: MediaKind };

export type DragState = {
  anchorId: string;
  pointerId: number;
  startX: number;
  startY: number;
  orig: Map<string, DragOrig>;
  moved: boolean;
  lastDx: number;
  lastDy: number;
};

export type MarqueeState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  baseSet: Set<string>;
  additive: boolean;
  moved: boolean;
};

export type DrawBoxState = {
  imageId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  imageX: number;
  imageY: number;
  imageW: number;
  imageH: number;
  moved: boolean;
};

export type UserBox = {
  id: string;
  box: [number, number, number, number];
  label: string;
};

export type PendingBoxLabel = {
  imageId: string;
  boxId: string;
  relBox: [number, number, number, number];
  imageW: number;
  imageH: number;
  worldRect: { x1: number; y1: number; x2: number; y2: number };
};

export type UploadPhase = 'sending' | 'finalizing' | 'error';
export type UploadStatus = { phase: UploadPhase; pct: number; message?: string };

export type SegMask = {
  png_base64: string;
  edge_png_base64?: string;
  width: number;
  height: number;
  score: number;
  bbox: [number, number, number, number] | null;
};

export type SegmentResponse = {
  masks: SegMask[];
  source_width: number;
  source_height: number;
};

export type TagSegment =
  | { tag: string; status: 'loading'; kind?: 'box'; boxId?: string }
  | { tag: string; status: 'ready'; response: SegmentResponse; kind?: 'box'; boxId?: string }
  | { tag: string; status: 'error'; message: string; kind?: 'box'; boxId?: string };

export type SegmentState = { entries: TagSegment[] };

export type UploadPlan = {
  draft: CanvasMedia;
  file: File;
  meta: { x: number; y: number; width: number; height: number; name: string };
};

export type MediaPointerEvent = React.PointerEvent<HTMLElement>;
