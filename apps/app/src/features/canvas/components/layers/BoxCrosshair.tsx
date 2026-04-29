import type { View, WorldPoint } from '../../../../InfiniteCanvas';
import type { CanvasMedia } from '../../lib';

type ActiveRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  tool: 'drag' | 'box';
  activeMedia: CanvasMedia | null;
  activeRect: ActiveRect | null;
  cursor: WorldPoint | null;
  view: View;
};

export function BoxCrosshair({
  tool,
  activeMedia,
  activeRect,
  cursor,
  view,
}: Props) {
  if (tool !== 'box' || !activeMedia || !activeRect || !cursor) return null;
  const cx = cursor.worldX * view.scale + view.x;
  const cy = cursor.worldY * view.scale + view.y;
  if (
    cx < activeRect.x ||
    cx > activeRect.x + activeRect.width ||
    cy < activeRect.y ||
    cy > activeRect.y + activeRect.height
  ) {
    return null;
  }
  return (
    <div
      className="box-crosshair"
      aria-hidden
      style={{
        left: activeRect.x,
        top: activeRect.y,
        width: activeRect.width,
        height: activeRect.height,
      }}
    >
      <span
        className="box-crosshair-line is-vertical"
        style={{ left: cx - activeRect.x }}
      />
      <span
        className="box-crosshair-line is-horizontal"
        style={{ top: cy - activeRect.y }}
      />
    </div>
  );
}
