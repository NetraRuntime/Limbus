import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createLodCache, type LodCache } from './lodCache';

const blob = (bytes: number): Blob =>
  new Blob([new Uint8Array(bytes)], { type: 'image/webp' });

async function createFreshCache(budgetBytes: number): Promise<LodCache> {
  // Match the beforeEach isolation pattern: reset fake-indexeddb's global factory
  // so each call gets a blank DB.
  globalThis.indexedDB = new IDBFactory();
  return createLodCache({ budgetBytes });
}

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

describe('lodCache eviction + delete', () => {
  it('evicts non-baseline levels when over budget, keeps baseline', async () => {
    // Fresh cache with budget sized to keep only the latest non-baseline level.
    // IMPORTANT: this test relies on deterministic lastAccessed ordering
    // between the three 128-level writes, so we interleave puts with
    // tiny waits.
    const cache = await createFreshCache(720);
    // Fill with 3 baselines (64 px) and 3 larger levels (128 px).
    await cache.put('a', 64, 'image', blob(80));
    await cache.put('b', 64, 'image', blob(80));
    await cache.put('c', 64, 'image', blob(80));
    await cache.put('a', 128, 'image', blob(300));
    await new Promise((r) => setTimeout(r, 2));
    await cache.put('b', 128, 'image', blob(300));
    await new Promise((r) => setTimeout(r, 2));
    await cache.put('c', 128, 'image', blob(300));
    // Budget is 720, drain target is 648. Baselines = 240 bytes, protected.
    // Each 128 level is 300 bytes. Room for only 1 non-baseline: 240 + 300 = 540 <= 648.
    // Eviction keeps newest (c@128), drops oldest-first: a@128, b@128.
    expect(await cache.has('a', 128)).toBe(false);
    expect(await cache.has('b', 128)).toBe(false);
    expect(await cache.has('c', 128)).toBe(true);
    // Baselines intact.
    expect(await cache.has('a', 64)).toBe(true);
    expect(await cache.has('b', 64)).toBe(true);
    expect(await cache.has('c', 64)).toBe(true);
  });

  it('delete(assetId) removes every level and dims for that asset', async () => {
    const cache = await createFreshCache(1024 * 1024);
    await cache.put('x', 64, 'image', blob(40));
    await cache.put('x', 128, 'image', blob(80));
    await cache.putDims('x', 800, 600);
    await cache.put('y', 64, 'image', blob(40));

    await cache.delete('x');

    expect(await cache.has('x', 64)).toBe(false);
    expect(await cache.has('x', 128)).toBe(false);
    expect(await cache.getDims('x')).toBeNull();
    expect(await cache.has('y', 64)).toBe(true);
    expect(await cache.totalBytes()).toBe(40);
  });
});
