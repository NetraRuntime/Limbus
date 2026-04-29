import type { View } from '../../../canvas-core';

type Rect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null;

type Props = {
  rect: Rect;
  view: View;
};

export function MarqueeRect({ rect, view }: Props) {
  if (!rect) return null;
  return (
    <div
      className="marquee-rect"
      aria-hidden
      style={{
        left: rect.minX * view.scale + view.x,
        top: rect.minY * view.scale + view.y,
        width: Math.max(0, (rect.maxX - rect.minX) * view.scale),
        height: Math.max(0, (rect.maxY - rect.minY) * view.scale),
      }}
    />
  );
}
