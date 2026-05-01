import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFitBounds } from './useFitBounds';

describe('useFitBounds', () => {
  it('returns null when there are no items', () => {
    const { result } = renderHook(() =>
      useFitBounds([], () => null),
    );
    expect(result.current()).toBeNull();
  });

  it('returns the bounding rect of all items with sizes', () => {
    const items = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 20 },
    ];
    const sizeOf = (item: { id: string }) =>
      item.id === 'a' ? { w: 4, h: 4 } : { w: 6, h: 6 };
    const { result } = renderHook(() => useFitBounds(items, sizeOf));
    expect(result.current()).toEqual({ x: 0, y: 0, width: 16, height: 26 });
  });

  it('skips items with no size', () => {
    const items = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 100 },
    ];
    const sizeOf = (item: { id: string }) =>
      item.id === 'a' ? { w: 4, h: 4 } : null;
    const { result } = renderHook(() => useFitBounds(items, sizeOf));
    expect(result.current()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });
});
