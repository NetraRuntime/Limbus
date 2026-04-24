export type SignatureInput = ReadonlyArray<{
  tag: string;
  maskIndex: number;
  png_base64: string;
}>;

/**
 * Build a deterministic fingerprint of a per-image "ready masks" list.
 * Signature equality implies identical bake output. Render order is
 * significant — later masks paint over earlier ones, so reordering
 * changes the signature.
 *
 * Tag matching is case-insensitive (matches the app's existing tag
 * identity rules — see `submitSegment` in Canvas.tsx). The base64 is
 * sampled by length + head + tail to avoid hashing multi-MB payloads
 * while still catching content changes.
 */
export function computeSignature(masks: SignatureInput): string {
  const parts: string[] = [];
  for (const m of masks) {
    const png = m.png_base64;
    const head = png.slice(0, 16);
    const tail = png.slice(-16);
    parts.push(`${m.tag.toLowerCase()}|${m.maskIndex}|${png.length}|${head}|${tail}`);
  }
  return parts.join('\n');
}
