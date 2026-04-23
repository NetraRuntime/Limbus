import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { createLodCache, type LodCache } from '../api/lodCache';
import { useLodSources, type VisibleItem } from './useLodSources';

// Stub URL object lifecycle (jsdom has no real blob URLs).
let nextBlobId = 1;
const blobUrls = new Map<string, Blob>();
beforeEach(() => {
  nextBlobId = 1;
  blobUrls.clear();
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = (b: Blob) => {
    const id = `blob:mock/${nextBlobId++}`;
    blobUrls.set(id, b);
    return id;
  };
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = (url: string) => {
    blobUrls.delete(url);
  };
});

const blob = (n: number): Blob =>
  new Blob([new Uint8Array(n)], { type: 'image/webp' });

const item = (overrides: Partial<VisibleItem> = {}): VisibleItem => ({
  id: 'a',
  kind: 'image',
  src: 'http://example.test/full.png',
  width: 1000,
  height: 800,
  ...overrides,
});

describe('useLodSources', () => {
  let cache: LodCache;

  beforeEach(async () => {
    // Mirror the lodCache test-isolation pattern: reset fake-indexeddb's
    // factory rather than calling deleteDatabase (which blocks on open
    // connections).
    const { IDBFactory } = await import('fake-indexeddb');
    (globalThis as unknown as { indexedDB: typeof indexedDB }).indexedDB = new IDBFactory();
    cache = await createLodCache({ budgetBytes: 1 << 20 });
    await cache.putDims('a', 1000, 800);
    await cache.put('a', 64, 'image', blob(10));
    await cache.put('a', 256, 'image', blob(40));
  });

  it('picks 64-px mip when zoomed out', async () => {
    // Stable reference avoids re-triggering the items useEffect on every render.
    const items: VisibleItem[] = [item()];
    const { result } = renderHook(() =>
      useLodSources({
        items,
        viewScale: 0.05, // 1000 × 0.05 = 50 px on-screen
        dpr: 1,
        cache,
      }),
    );
    await waitFor(() => {
      expect(result.current.sources.get('a')?.isFallback).toBe(false);
    });
    const got = result.current.sources.get('a')!;
    expect(got.isFallback).toBe(false);
    expect(got.lodSrc.startsWith('blob:')).toBe(true);
    expect(got.playVideo).toBe(false);
  });

  it('falls back to full-res when no cached level fits', async () => {
    const items: VisibleItem[] = [item()];
    const { result } = renderHook(() =>
      useLodSources({
        items,
        viewScale: 2, // 1000 × 2 = 2000 px on-screen → needs > 1024
        dpr: 1,
        cache,
      }),
    );
    await waitFor(() => {
      const src = result.current.sources.get('a');
      expect(src).toBeTruthy();
    });
    const got = result.current.sources.get('a')!;
    expect(got.isFallback).toBe(true);
    expect(got.lodSrc).toBe('http://example.test/full.png');
  });

  it('marks videos below 1024 px as playVideo=false', async () => {
    await cache.putDims('v', 1920, 1080);
    await cache.put('v', 64, 'image', blob(10));
    const items: VisibleItem[] = [item({ id: 'v', kind: 'video', width: 1920, height: 1080 })];
    const { result } = renderHook(() =>
      useLodSources({ items, viewScale: 0.2, dpr: 1, cache }),
    );
    await waitFor(() => expect(result.current.sources.get('v')).toBeTruthy());
    expect(result.current.sources.get('v')?.playVideo).toBe(false);
  });

  it('marks videos above 1024 px as playVideo=true', async () => {
    await cache.putDims('v', 1920, 1080);
    await cache.put('v', 64, 'image', blob(10));
    const items: VisibleItem[] = [item({ id: 'v', kind: 'video', width: 1920, height: 1080 })];
    const { result } = renderHook(() =>
      useLodSources({ items, viewScale: 1.0, dpr: 1, cache }),
    );
    await waitFor(() => expect(result.current.sources.get('v')).toBeTruthy());
    expect(result.current.sources.get('v')?.playVideo).toBe(true);
  });

  it('dropAsset revokes URLs and clears state', async () => {
    const items: VisibleItem[] = [item()];
    const { result } = renderHook(() =>
      useLodSources({
        items,
        viewScale: 0.05,
        dpr: 1,
        cache,
      }),
    );
    await waitFor(() => expect(result.current.sources.get('a')?.isFallback).toBe(false));
    const urlBefore = result.current.sources.get('a')!.lodSrc;
    expect(blobUrls.has(urlBefore)).toBe(true);
    act(() => result.current.dropAsset('a'));
    expect(blobUrls.has(urlBefore)).toBe(false);
  });
});
