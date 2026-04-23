import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDecodeCache } from './decodeCache';

type FakeBitmap = { id: number; closed: boolean };

let nextId = 1;
function mkBitmap(): FakeBitmap {
  return { id: nextId++, closed: false };
}

beforeEach(() => {
  nextId = 1;
});

describe('createDecodeCache', () => {
  it('decodes once and caches per base64', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache({ capacity: 4, decode });
    const a = await cache.get('AAA');
    const a2 = await cache.get('AAA');
    expect(a).toBe(a2);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used entry and closes its bitmap', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache<FakeBitmap>({
      capacity: 2,
      decode,
      closeBitmap: (b) => {
        b.closed = true;
      },
    });
    const a = await cache.get('A');
    const b = await cache.get('B');
    await cache.get('A'); // touch A so B is LRU
    await cache.get('C'); // should evict B
    expect(b.closed).toBe(true);
    expect(a.closed).toBe(false);
    // 'B' is gone; a new get re-decodes.
    await cache.get('B');
    expect(decode).toHaveBeenCalledTimes(4);
  });

  it('drop() removes a specific entry and closes it', async () => {
    const decode = vi.fn(async () => mkBitmap());
    const cache = createDecodeCache<FakeBitmap>({
      capacity: 4,
      decode,
      closeBitmap: (b) => {
        b.closed = true;
      },
    });
    const a = await cache.get('A');
    cache.drop('A');
    expect(a.closed).toBe(true);
    await cache.get('A'); // re-decodes
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
