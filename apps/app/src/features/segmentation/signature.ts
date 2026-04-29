export type SignatureInput = ReadonlyArray<{
  tag: string;
  maskIndex: number;
  png_base64: string;
  entryId?: string;
}>;

/** Order-sensitive fingerprint; samples base64 head+tail+length to avoid hashing multi-MB payloads. */
export function computeSignature(masks: SignatureInput): string {
  const parts: string[] = [];
  for (const m of masks) {
    const png = m.png_base64;
    const head = png.slice(0, 16);
    const tail = png.slice(-16);
    parts.push(
      `${m.tag.toLowerCase()}|${m.entryId ?? ''}|${m.maskIndex}|${png.length}|${head}|${tail}`,
    );
  }
  return parts.join('\n');
}
