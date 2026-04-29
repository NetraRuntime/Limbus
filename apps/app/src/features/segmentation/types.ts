export type MaskIdentity = {
  imageId: string;
  tag: string;
  maskIndex: number;
  /** Discriminator when two box entries share a display tag (e.g. two boxes both labeled "cat"). */
  entryId?: string;
};

export type ComposeInput = {
  sourceW: number;
  sourceH: number;
  maxSide?: number;
  masks: ReadonlyArray<{
    tag: string;
    maskIndex: number;
    png_base64: string;
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
    entryId?: string;
  }>;
  decodeCache: {
    get: (key: string) => Promise<ImageBitmap>;
  };
};

/** Iterate in reverse for topmost-first (masks are stored in paint order). */
export type HitMask = {
  tag: string;
  maskIndex: number;
  entryId?: string;
  rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  bbox: { x: number; y: number; w: number; h: number };
};

export type ComposedBake = {
  bitmap: ImageBitmap;
  hitMasks: ReadonlyArray<HitMask>;
  width: number;
  height: number;
};

export type BakeEntry = ComposedBake & {
  signature: string;
};
