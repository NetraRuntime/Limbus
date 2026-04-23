type Dims = { width: number; height: number };
type Anchor = { worldX: number; worldY: number };
type PlacedRect = { x: number; y: number; width: number; height: number };

export function placeGrid(
  items: readonly Dims[],
  anchor: Anchor,
  gap: number,
): PlacedRect[] {
  if (items.length === 0) return [];

  const maxW = items.reduce((m, i) => Math.max(m, i.width), 0);
  const maxH = items.reduce((m, i) => Math.max(m, i.height), 0);
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const cellW = maxW + gap;
  const cellH = maxH + gap;
  const clusterW = items.length === 1 ? maxW : cols * cellW;
  const clusterH = items.length === 1 ? maxH : rows * cellH;
  const originX = anchor.worldX - clusterW / 2;
  const originY = anchor.worldY - clusterH / 2;

  return items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: originX + col * cellW,
      y: originY + row * cellH,
      width: item.width,
      height: item.height,
    };
  });
}
