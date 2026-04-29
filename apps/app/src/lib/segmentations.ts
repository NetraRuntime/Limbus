export type SegMask = {
  png_base64: string;
  edge_png_base64?: string;
  width: number;
  height: number;
  score: number;
  bbox: [number, number, number, number] | null;
};

export type SegmentationRow = {
  id: string;
  image: string;
  tag: string;
  masks: SegMask[];
  source_width: number;
  source_height: number;
};

export const findSegByTag = (
  rows: readonly SegmentationRow[],
  tag: string,
): SegmentationRow | undefined => {
  const key = tag.toLowerCase();
  return rows.find((r) => r.tag.toLowerCase() === key);
};

export const segIdsToPrune = (
  rows: readonly SegmentationRow[],
  tagsToKeep: readonly string[],
): string[] => {
  const keep = new Set(tagsToKeep.map((t) => t.toLowerCase()));
  return rows.filter((r) => !keep.has(r.tag.toLowerCase())).map((r) => r.id);
};

export const groupSegmentationsByImage = (
  rows: readonly SegmentationRow[],
): Map<string, SegmentationRow[]> => {
  const out = new Map<string, SegmentationRow[]>();
  for (const r of rows) {
    const list = out.get(r.image);
    if (list) list.push(r);
    else out.set(r.image, [r]);
  }
  return out;
};
