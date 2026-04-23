import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  __resetBakeCacheForTests,
  __setComposeForTests,
  useSegmentBake,
  type BakeHookInput,
} from './bakeCache';
import type { ComposedBake } from './types';

function mkFakeBake(idMapFill: number, bitmapId: number): ComposedBake {
  const idMap = new Uint16Array(4);
  idMap.fill(idMapFill);
  const fake = { id: bitmapId, closed: false, close() { this.closed = true; } };
  const bitmap = fake as unknown as ImageBitmap;
  return { bitmap, idMap, idToMask: [], width: 2, height: 2 };
}

const mkInput = (overrides: Partial<BakeHookInput> = {}): BakeHookInput => ({
  imageId: 'img1',
  sourceW: 100,
  sourceH: 100,
  masks: [
    {
      tag: 'cat',
      maskIndex: 0,
      png_base64: 'AAAA',
      maskW: 100,
      maskH: 100,
      bbox: null,
      accent: '#ff0000',
    },
  ],
  ...overrides,
});

beforeEach(() => {
  __resetBakeCacheForTests();
});

describe('useSegmentBake', () => {
  it('invokes compose once on mount and returns the bake', async () => {
    const compose = vi.fn(async () => mkFakeBake(5, 1));
    __setComposeForTests(compose);
    const { result } = renderHook(() => useSegmentBake(mkInput()));
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    expect(result.current.bake!.idMap[0]).toBe(5);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('does not re-compose when the signature is unchanged', async () => {
    const compose = vi.fn(async () => mkFakeBake(5, 1));
    __setComposeForTests(compose);
    const { result, rerender } = renderHook(
      (input: BakeHookInput) => useSegmentBake(input),
      { initialProps: mkInput() },
    );
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    rerender(mkInput()); // identical props
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it('re-composes when the signature changes', async () => {
    const compose = vi.fn((): Promise<ComposedBake> =>
      Promise.resolve(mkFakeBake(5, compose.mock.calls.length + 1)),
    );
    __setComposeForTests(compose);
    const { result, rerender } = renderHook(
      (input: BakeHookInput) => useSegmentBake(input),
      { initialProps: mkInput() },
    );
    await waitFor(() => expect(result.current.bake).not.toBeNull());
    const next = mkInput({
      masks: [
        {
          tag: 'cat',
          maskIndex: 0,
          png_base64: 'DIFFERENT',
          maskW: 100,
          maskH: 100,
          bbox: null,
          accent: '#ff0000',
        },
      ],
    });
    rerender(next);
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(2));
  });
});
