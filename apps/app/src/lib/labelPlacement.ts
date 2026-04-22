export type LabelPlacement = 'tl' | 'tr' | 'bl' | 'br';

export type PlacementItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
};

export type PlacementInput = {
  items: PlacementItem[];
  rank: (id: string) => number;
  scale: number;
  labelWidth: (name: string) => number;
};

const LABEL_HEIGHT_PX = 19;
const LABEL_GAP_PX = 6;

type Rect = { x: number; y: number; w: number; h: number };

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const CANDIDATES: LabelPlacement[] = ['tl', 'tr', 'bl', 'br'];

const candidateRect = (
  placement: LabelPlacement,
  item: PlacementItem,
  labelW: number,
  labelH: number,
  gap: number,
): Rect => {
  switch (placement) {
    case 'tl':
      return { x: item.x, y: item.y - labelH - gap, w: labelW, h: labelH };
    case 'tr':
      return {
        x: item.x + item.width - labelW,
        y: item.y - labelH - gap,
        w: labelW,
        h: labelH,
      };
    case 'bl':
      return {
        x: item.x,
        y: item.y + item.height + gap,
        w: labelW,
        h: labelH,
      };
    case 'br':
      return {
        x: item.x + item.width - labelW,
        y: item.y + item.height + gap,
        w: labelW,
        h: labelH,
      };
  }
};

export function computeLabelPlacements(
  input: PlacementInput,
): Map<string, LabelPlacement> {
  const { items, rank, scale, labelWidth } = input;
  const out = new Map<string, LabelPlacement>();
  if (items.length === 0) return out;

  const labelHw = LABEL_HEIGHT_PX / scale;
  const gapW = LABEL_GAP_PX / scale;

  for (const item of items) {
    const ri = rank(item.id);
    const labelWw = labelWidth(item.name) / scale;

    const higher: Rect[] = [];
    for (const other of items) {
      if (other.id === item.id) continue;
      if (rank(other.id) <= ri) continue;
      higher.push({
        x: other.x,
        y: other.y,
        w: other.width,
        h: other.height,
      });
    }

    let picked: LabelPlacement = 'tl';
    if (higher.length > 0) {
      let found: LabelPlacement | null = null;
      for (const cand of CANDIDATES) {
        const r = candidateRect(cand, item, labelWw, labelHw, gapW);
        let hit = false;
        for (const h of higher) {
          if (intersects(r, h)) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          found = cand;
          break;
        }
      }
      picked = found ?? 'tl';
    }

    out.set(item.id, picked);
  }

  return out;
}
