import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { AssetKind, LodEntry } from '../types';
import {
  CACHE_DRAIN_TO_FRACTION,
  DEFAULT_CACHE_BUDGET_BYTES,
  MIN_LEVEL_PX,
} from '../types';

const DB_NAME = 'netra-lod';
const DB_VERSION = 1;

type DimsRecord = { assetId: string; naturalWidth: number; naturalHeight: number };
type MetaRecord = { totalBytes: number };

interface LodSchema extends DBSchema {
  lod: { key: string; value: LodEntry };
  dims: { key: string; value: DimsRecord };
  meta: { key: string; value: MetaRecord };
}

const entryKey = (assetId: string, levelPx: number) => `${assetId}|${levelPx}`;

export type LodCache = {
  put: (assetId: string, levelPx: number, kind: AssetKind, blob: Blob) => Promise<void>;
  get: (assetId: string, levelPx: number) => Promise<LodEntry | null>;
  has: (assetId: string, levelPx: number) => Promise<boolean>;
  delete: (assetId: string) => Promise<void>;
  totalBytes: () => Promise<number>;
  putDims: (assetId: string, naturalWidth: number, naturalHeight: number) => Promise<void>;
  getDims: (assetId: string) => Promise<{ naturalWidth: number; naturalHeight: number } | null>;
};

export type LodCacheOptions = {
  budgetBytes?: number;
};

/** Opens the IDB cache. Creates the database on first run. */
export async function createLodCache(opts: LodCacheOptions = {}): Promise<LodCache> {
  const budget = opts.budgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES;
  const db = await openDB<LodSchema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('lod')) database.createObjectStore('lod');
      if (!database.objectStoreNames.contains('dims')) database.createObjectStore('dims');
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
    },
  });

  const readTotalBytes = async (): Promise<number> => {
    const m = await db.get('meta', 'total');
    return m?.totalBytes ?? 0;
  };

  return {
    async put(assetId, levelPx, kind, blob) {
      const bytes = blob.size;
      const entry: LodEntry = {
        assetId,
        levelPx,
        kind,
        blob,
        bytes,
        lastAccessed: Date.now(),
      };
      const k = entryKey(assetId, levelPx);
      const tx = db.transaction(['lod', 'meta'], 'readwrite');
      const prior = await tx.objectStore('lod').get(k);
      const priorBytes = prior?.bytes ?? 0;
      await tx.objectStore('lod').put(entry, k);
      const current = await tx.objectStore('meta').get('total');
      const newTotal = (current?.totalBytes ?? 0) - priorBytes + bytes;
      await tx.objectStore('meta').put({ totalBytes: newTotal }, 'total');
      await tx.done;
      if (newTotal > budget) {
        await evictToFraction(db, budget * CACHE_DRAIN_TO_FRACTION);
      }
    },

    async get(assetId, levelPx) {
      const k = entryKey(assetId, levelPx);
      const entry = await db.get('lod', k);
      if (!entry) return null;
      // Touch lastAccessed asynchronously; do not block the caller.
      void (async () => {
        const tx = db.transaction('lod', 'readwrite');
        const fresh = await tx.objectStore('lod').get(k);
        if (fresh) {
          fresh.lastAccessed = Date.now();
          await tx.objectStore('lod').put(fresh, k);
        }
        await tx.done;
      })();
      return entry;
    },

    async has(assetId, levelPx) {
      const k = entryKey(assetId, levelPx);
      const count = await db.count('lod', IDBKeyRange.only(k));
      return count > 0;
    },

    async delete(assetId) {
      const tx = db.transaction(['lod', 'dims', 'meta'], 'readwrite');
      const lodStore = tx.objectStore('lod');
      const all = await lodStore.getAll();
      let removed = 0;
      for (const entry of all) {
        if (entry.assetId === assetId) {
          await lodStore.delete(entryKey(entry.assetId, entry.levelPx));
          removed += entry.bytes;
        }
      }
      await tx.objectStore('dims').delete(assetId);
      const m = await tx.objectStore('meta').get('total');
      const newTotal = Math.max(0, (m?.totalBytes ?? 0) - removed);
      await tx.objectStore('meta').put({ totalBytes: newTotal }, 'total');
      await tx.done;
    },

    totalBytes: readTotalBytes,

    async putDims(assetId, naturalWidth, naturalHeight) {
      await db.put('dims', { assetId, naturalWidth, naturalHeight }, assetId);
    },

    async getDims(assetId) {
      const d = await db.get('dims', assetId);
      if (!d) return null;
      return { naturalWidth: d.naturalWidth, naturalHeight: d.naturalHeight };
    },
  };
}

async function evictToFraction(
  db: IDBPDatabase<LodSchema>,
  targetBytes: number,
): Promise<void> {
  const tx = db.transaction(['lod', 'meta'], 'readwrite');
  const lodStore = tx.objectStore('lod');
  const entries = await lodStore.getAll();
  const evictable = entries
    .filter((e) => e.levelPx > MIN_LEVEL_PX)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  for (const e of evictable) {
    if (total <= targetBytes) break;
    await lodStore.delete(entryKey(e.assetId, e.levelPx));
    total -= e.bytes;
  }
  await tx.objectStore('meta').put({ totalBytes: total }, 'total');
  await tx.done;
}
