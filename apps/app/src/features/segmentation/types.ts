/**
 * One mask's identity within a per-image bake. The tuple (imageId, tag,
 * maskIndex) uniquely identifies a mask in the app's segmentation state.
 */
export type MaskIdentity = {
  imageId: string;
  tag: string;
  maskIndex: number;
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
    // Optional thin anti-aliased ring around the mask's contour.
    // SAM3 emits this alongside the fill; the composer paints it in
    // white on top of the fill to outline each mask.
    edge_png_base64?: string;
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
  }>;
  decodeCache: {
    get: (key: string) => Promise<ImageBitmap>;
  };
};

/**
 * Output of composeBake. `bitmap` is the visible composite;
 * `idMap[y*width + x]` holds the 1-based id of the topmost mask at
 * that pixel, or 0 if empty. `idToMask[id - 1]` maps back to the
 * mask's identity (tag, maskIndex).
 */
export type ComposedBake = {
  bitmap: ImageBitmap;
  idMap: Uint16Array;
  idToMask: ReadonlyArray<{ tag: string; maskIndex: number }>;
  width: number;
  height: number;
};

/** Cached per-image bake entry. */
export type BakeEntry = ComposedBake & {
  signature: string;
};
