import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createLodCache, type LodCache } from './lodCache';

const blob = (bytes: number): Blob =>
  new Blob([new Uint8Array(bytes)], { type: 'image/webp' });

describe('lodCache', () => {
  let cache: LodCache;

  beforeEach(async () => {
    // Fresh IDB instance per test — avoids deleteDatabase blocking on open connections.
    globalThis.indexedDB = new IDBFactory();
    cache = await createLodCache({ budgetBytes: 1024 * 1024 });
  });

  it('put + get round-trips a blob', async () => {
    const b = blob(100);
    await cache.put('a', 64, 'image', b);
    const got = await cache.get('a', 64);
    expect(got?.bytes).toBe(100);
    expect(got?.blob.size).toBe(100);
  });

  it('get returns null on miss', async () => {
    expect(await cache.get('missing', 64)).toBeNull();
  });

  it('tracks total bytes across puts', async () => {
    await cache.put('a', 64, 'image', blob(100));
    await cache.put('a', 128, 'image', blob(250));
    await cache.put('b', 64, 'image', blob(50));
    expect(await cache.totalBytes()).toBe(400);
  });

  it('overwrite replaces old entry in totalBytes (not additive)', async () => {
    await cache.put('a', 64, 'image', blob(100));
    await cache.put('a', 64, 'image', blob(50));
    expect(await cache.totalBytes()).toBe(50);
  });

  it('putDims / getDims round-trips source dimensions', async () => {
    await cache.putDims('a', 1024, 768);
    const dims = await cache.getDims('a');
    expect(dims).toEqual({ naturalWidth: 1024, naturalHeight: 768 });
  });

  it('getDims returns null when unset', async () => {
    expect(await cache.getDims('missing')).toBeNull();
  });
});
