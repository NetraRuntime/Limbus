export type MaskIdentity = {
  imageId: string;
  tag: string;
  maskIndex: number;
  /** Optional entry discriminator. Two box entries can share a display
   *  tag (two boxes both labeled "cat"); `entryId` makes the identity
   *  unique so hover/click land on the intended entry. Undefined for
   *  text segments where tag is already unique. */
  entryId?: string;
};

/**
 * Input to composeBake. Each entry is one already-ready mask ready to
 * be composited. `sourceW`/`sourceH` determine the bake canvas' target
 * resolution (capped by `maxSide`). `decodeCache` is consulted/filled
 * by the composer to avoid re-decoding identical base64 payloads.
 */
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
    /** See MaskIdentity.entryId — threaded through compose so hit-test
     *  records carry it back to the identity returned on click/hover. */
    entryId?: string;
  }>;
  decodeCache: {
    get: (key: string) => Promise<ImageBitmap>;
  };
};

/**
 * Per-mask hit-test record built by composeBake. `rings` are smoothed
 * polygon rings in bake-pixel space. `bbox` is the axis-aligned
 * bounding rectangle of those rings in bake-pixel space, used as a
 * cheap O(1) pre-filter before the even-odd ring test. Masks are
 * ordered exactly as they were painted, so iterating the array in
 * reverse yields topmost-first.
 */
export type HitMask = {
  tag: string;
  maskIndex: number;
  /** See MaskIdentity.entryId. */
  entryId?: string;
  rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  bbox: { x: number; y: number; w: number; h: number };
};

/**
 * Output of composeBake. `bitmap` is the visible composite (mask fills
 * + white edge strokes). `hitMasks` carries the per-mask rings + bbox
 * used by the main-thread hit test; masks are in paint order, so
 * topmost-first iteration is `hitMasks[i]` for `i = len-1 .. 0`.
 */
export type ComposedBake = {
  bitmap: ImageBitmap;
  hitMasks: ReadonlyArray<HitMask>;
  width: number;
  height: number;
};

/** Cached per-image bake entry. */
export type BakeEntry = ComposedBake & {
  signature: string;
};
