import { useCallback } from 'react';
import type { WorldRect } from '../InfiniteCanvas';

type Positioned = { id: string; x: number; y: number };
type Size = { w: number; h: number };

export function useFitBounds<T extends Positioned>(
  items: readonly T[],
  sizeOf: (id: string) => Size | null | undefined,
): () => WorldRect | null {
  return useCallback(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const item of items) {
      const size = sizeOf(item.id);
      if (!size) continue;
      any = true;
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + size.w > maxX) maxX = item.x + size.w;
      if (item.y + size.h > maxY) maxY = item.y + size.h;
    }
    if (!any) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [items, sizeOf]);
}
