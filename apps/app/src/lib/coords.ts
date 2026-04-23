import type { View, WorldPoint } from '../InfiniteCanvas';

export type ScreenAndWorld = WorldPoint & { screenX: number; screenY: number };

export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  view: View,
): ScreenAndWorld {
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  return {
    screenX,
    screenY,
    worldX: (screenX - view.x) / view.scale,
    worldY: (screenY - view.y) / view.scale,
  };
}
