import { useCallback } from 'react';
import type { WorldRect } from '../InfiniteCanvas';

type Positioned = { id: string; x: number; y: number };
type Size = { w: number; h: number };

export function useFitBounds<T extends Positioned>(
  items: readonly T[],
  sizeOf: (item: T) => Size | null | undefined,
): () => WorldRect | null {
  return useCallback(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasAny = false;
    for (const item of items) {
      const size = sizeOf(item);
      if (!size) continue;
      hasAny = true;
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + size.w > maxX) maxX = item.x + size.w;
      if (item.y + size.h > maxY) maxY = item.y + size.h;
    }
    if (!hasAny) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [items, sizeOf]);
}
