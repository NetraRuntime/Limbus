/**
 * LRU cache for decoded mask bitmaps keyed by base64 payload. Insertion
 * order in a `Map` reflects access order because every touch re-sets
 * the key, which moves it to the end.
 */
export type DecodeCache<B = ImageBitmap> = {
  get: (key: string) => Promise<B>;
  drop: (key: string) => void;
  clear: () => void;
};

export type DecodeCacheOptions<B = ImageBitmap> = {
  capacity: number;
  decode: (key: string) => Promise<B>;
  closeBitmap?: (bmp: B) => void;
};

export function createDecodeCache<B = ImageBitmap>(
  opts: DecodeCacheOptions<B>,
): DecodeCache<B> {
  const { capacity, decode, closeBitmap } = opts;
  const map = new Map<string, B>();

  const close = (bmp: B) => {
    if (closeBitmap) closeBitmap(bmp);
  };

  const touch = (key: string, bmp: B) => {
    map.delete(key);
    map.set(key, bmp);
  };

  const evict = () => {
    while (map.size > capacity) {
      const oldestKey = map.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const bmp = map.get(oldestKey);
      map.delete(oldestKey);
      if (bmp !== undefined) close(bmp);
    }
  };

  return {
    async get(key) {
      const hit = map.get(key);
      if (hit !== undefined) {
        touch(key, hit);
        return hit;
      }
      const bmp = await decode(key);
      map.set(key, bmp);
      evict();
      return bmp;
    },
    drop(key) {
      const bmp = map.get(key);
      if (bmp !== undefined) {
        map.delete(key);
        close(bmp);
      }
    },
    clear() {
      for (const bmp of map.values()) close(bmp);
      map.clear();
    },
  };
}
