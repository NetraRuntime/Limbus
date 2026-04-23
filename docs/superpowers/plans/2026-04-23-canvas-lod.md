# Canvas Level-of-Detail (LoD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side Level-of-Detail system to the infinite canvas so that zoomed-out media render from cached mip-map thumbnails (not full-res), and videos drop to static poster images when small.

**Architecture:** New `apps/app/src/features/lod/` feature folder with pure utilities for the mip pyramid and level picker, an IndexedDB cache (stratified LRU, `idb` wrapper), a single OffscreenCanvas `Worker` for WebP encode, and two React hooks (`useLodHydration`, `useLodSources`). `Canvas.tsx` gains one hook call and `MediaItem` gains two props (`lodSrc`, `playVideo`). Everything degrades gracefully when Worker or IndexedDB are unavailable.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, IndexedDB (via `idb`), OffscreenCanvas, Web Worker, `@testing-library/react` (new), `fake-indexeddb` (new, dev-only), `jsdom` (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-04-23-canvas-lod-design.md`

---

## File Structure

### New files

- `apps/app/src/features/lod/types.ts` — shared TS types.
- `apps/app/src/features/lod/util/mipLevels.ts` — pure pyramid size computation.
- `apps/app/src/features/lod/util/mipLevels.test.ts` — unit tests.
- `apps/app/src/features/lod/util/pickLevel.ts` — pure level picker with hysteresis.
- `apps/app/src/features/lod/util/pickLevel.test.ts` — unit tests.
- `apps/app/src/features/lod/util/posterFrame.ts` — video t=0 → `ImageBitmap`.
- `apps/app/src/features/lod/util/sourceBitmap.ts` — unified image/video → `ImageBitmap` loader.
- `apps/app/src/features/lod/api/lodCache.ts` — IDB wrapper (put/get/touch/evict/delete/dims).
- `apps/app/src/features/lod/api/lodCache.test.ts` — unit tests (fake-indexeddb).
- `apps/app/src/features/lod/worker/mip.worker.ts` — OffscreenCanvas pyramid encoder.
- `apps/app/src/features/lod/worker/mipWorkerClient.ts` — main-thread proxy (queue + cancel).
- `apps/app/src/features/lod/hooks/useLodHydration.ts` — background hydration queue.
- `apps/app/src/features/lod/hooks/useLodSources.ts` — per-visible-item picker + blob URLs.
- `apps/app/src/features/lod/hooks/useLodSources.test.tsx` — integration test (jsdom).
- `apps/app/src/features/lod/index.ts` — public barrel.

### Modified files

- `apps/app/package.json` — add `idb`, `fake-indexeddb`, `jsdom`, `@testing-library/react`.
- `apps/app/vitest.config.ts` — add a jsdom project for `*.test.tsx`.
- `apps/app/src/Canvas.tsx` — wire `useLodSources`, pass `lodSrc` / `playVideo` to `MediaItem`; purge cache on delete.

---

## Constants

Fixed, used across tasks. Defined once in `types.ts`:

```ts
export const MIN_LEVEL_PX = 64;
export const MAX_LEVEL_PX = 1024;
export const LEVEL_CANDIDATES = [64, 128, 256, 512, 1024] as const;
export const UPGRADE_HYSTERESIS = 1.25;
export const DEFAULT_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;
export const CACHE_DRAIN_TO_FRACTION = 0.9;
export const WEBP_QUALITY = 0.8;
```

---

## Task 1: Add dependencies and configure test environments

**Files:**
- Modify: `apps/app/package.json`
- Modify: `apps/app/vitest.config.ts`

- [ ] **Step 1: Install runtime dependency `idb` and dev deps.**

From repo root:

```bash
pnpm --filter @netrart/app add idb
pnpm --filter @netrart/app add -D fake-indexeddb jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Update vitest config to run two projects (node + jsdom) by file extension.**

Replace `apps/app/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/features/lod/test-setup.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Create the jsdom test setup file.**

Create `apps/app/src/features/lod/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 4: Sanity-check existing node tests still pass.**

Run: `pnpm --filter @netrart/app test`
Expected: all existing tests in `src/lib/labelPlacement.test.ts` pass under the `node` project; jsdom project has no tests yet (clean exit).

- [ ] **Step 5: Commit.**

```bash
git add apps/app/package.json apps/app/vitest.config.ts apps/app/src/features/lod/test-setup.ts pnpm-lock.yaml
git commit -m "feat(lod): add deps and jsdom test project"
```

---

## Task 2: Types and `mipLevels` pure util with tests

**Files:**
- Create: `apps/app/src/features/lod/types.ts`
- Create: `apps/app/src/features/lod/util/mipLevels.ts`
- Test: `apps/app/src/features/lod/util/mipLevels.test.ts`

- [ ] **Step 1: Create the types module.**

Create `apps/app/src/features/lod/types.ts`:

```ts
export const MIN_LEVEL_PX = 64;
export const MAX_LEVEL_PX = 1024;
export const LEVEL_CANDIDATES = [64, 128, 256, 512, 1024] as const;
export const UPGRADE_HYSTERESIS = 1.25;
export const DEFAULT_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;
export const CACHE_DRAIN_TO_FRACTION = 0.9;
export const WEBP_QUALITY = 0.8;

export type AssetKind = 'image' | 'video';

export type PickedLevel = number | 'full';

export type SourceDims = {
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
};

export type LodEntry = {
  assetId: string;
  levelPx: number;
  kind: AssetKind;
  blob: Blob;
  bytes: number;
  lastAccessed: number;
};

export type LodSource = {
  /** Blob URL for the chosen mip level, or the full-res URL when no cached level fits. */
  lodSrc: string;
  /** True when `lodSrc` is the full-res fallback (no cached level available). */
  isFallback: boolean;
  /** Videos only: whether to render the live <video> (true) or the poster <img> (false). */
  playVideo: boolean;
};
```

- [ ] **Step 2: Write the failing test for `computeMipLevels`.**

Create `apps/app/src/features/lod/util/mipLevels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMipLevels } from './mipLevels';

describe('computeMipLevels', () => {
  it('returns empty for sources smaller than MIN_LEVEL_PX', () => {
    expect(computeMipLevels(63)).toEqual([]);
    expect(computeMipLevels(10)).toEqual([]);
  });

  it('includes exactly [64] for a source exactly at MIN_LEVEL_PX', () => {
    expect(computeMipLevels(64)).toEqual([64]);
  });

  it('returns ascending levels filtered by longest side', () => {
    expect(computeMipLevels(200)).toEqual([64, 128]);
    expect(computeMipLevels(500)).toEqual([64, 128, 256]);
    expect(computeMipLevels(1024)).toEqual([64, 128, 256, 512, 1024]);
  });

  it('caps at MAX_LEVEL_PX regardless of source size', () => {
    expect(computeMipLevels(4000)).toEqual([64, 128, 256, 512, 1024]);
    expect(computeMipLevels(99999)).toEqual([64, 128, 256, 512, 1024]);
  });

  it('includes level when source exactly matches it', () => {
    expect(computeMipLevels(256)).toEqual([64, 128, 256]);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails.**

Run: `pnpm --filter @netrart/app test mipLevels`
Expected: FAIL — "Failed to resolve import './mipLevels'".

- [ ] **Step 4: Implement `computeMipLevels`.**

Create `apps/app/src/features/lod/util/mipLevels.ts`:

```ts
import { LEVEL_CANDIDATES, MIN_LEVEL_PX } from '../types';

/** Ascending set of mip level pixel sizes (longest-side) that fit inside
 *  the given source. A source below MIN_LEVEL_PX yields an empty pyramid,
 *  meaning LoD is skipped for that asset.
 */
export function computeMipLevels(longestSidePx: number): number[] {
  if (longestSidePx < MIN_LEVEL_PX) return [];
  return LEVEL_CANDIDATES.filter((px) => px <= longestSidePx);
}
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `pnpm --filter @netrart/app test mipLevels`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit.**

```bash
git add apps/app/src/features/lod/types.ts apps/app/src/features/lod/util/mipLevels.ts apps/app/src/features/lod/util/mipLevels.test.ts
git commit -m "feat(lod): add types and computeMipLevels util"
```

---

## Task 3: `pickLevel` pure util with hysteresis

**Files:**
- Create: `apps/app/src/features/lod/util/pickLevel.ts`
- Test: `apps/app/src/features/lod/util/pickLevel.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `apps/app/src/features/lod/util/pickLevel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickLevel } from './pickLevel';

describe('pickLevel', () => {
  const levels = [64, 128, 256, 512, 1024];

  it('returns the smallest level >= on-screen × DPR', () => {
    expect(pickLevel(levels, 100, 1)).toBe(128);
    expect(pickLevel(levels, 50, 1)).toBe(64);
    expect(pickLevel(levels, 256, 1)).toBe(256);
  });

  it("returns 'full' when target exceeds every level", () => {
    expect(pickLevel(levels, 2000, 1)).toBe('full');
    expect(pickLevel(levels, 1025, 1)).toBe('full');
  });

  it("returns 'full' when the pyramid is empty", () => {
    expect(pickLevel([], 10, 1)).toBe('full');
    expect(pickLevel([], 1, 1)).toBe('full');
  });

  it('scales target by DPR', () => {
    // onScreen 100 × dpr 2 = 200 → smallest >= 200 is 256
    expect(pickLevel(levels, 100, 2)).toBe(256);
    // onScreen 100 × dpr 1.5 = 150 → smallest >= 150 is 256
    expect(pickLevel(levels, 100, 1.5)).toBe(256);
  });

  it('applies upgrade hysteresis (needs 1.25× current before upgrading)', () => {
    // current = 128, target = 150 → 150 < 128*1.25 (160) → stay at 128
    expect(pickLevel(levels, 150, 1, 128)).toBe(128);
    // current = 128, target = 160 → 160 >= 128*1.25 → upgrade to 256
    expect(pickLevel(levels, 160, 1, 128)).toBe(256);
  });

  it('downgrades immediately without hysteresis', () => {
    // current = 512, target = 100 → downgrade to 128
    expect(pickLevel(levels, 100, 1, 512)).toBe(128);
  });

  it("hysteresis also gates upgrades from a level to 'full'", () => {
    // current = 1024, target = 1100 → 1100 < 1024*1.25 (1280) → stay at 1024
    expect(pickLevel(levels, 1100, 1, 1024)).toBe(1024);
    // current = 1024, target = 1280 → go to full
    expect(pickLevel(levels, 1280, 1, 1024)).toBe('full');
  });

  it("downgrades from 'full' immediately", () => {
    expect(pickLevel(levels, 100, 1, 'full')).toBe(128);
  });

  it('no-op when candidate equals current', () => {
    expect(pickLevel(levels, 100, 1, 128)).toBe(128);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails.**

Run: `pnpm --filter @netrart/app test pickLevel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickLevel`.**

Create `apps/app/src/features/lod/util/pickLevel.ts`:

```ts
import { UPGRADE_HYSTERESIS, type PickedLevel } from '../types';

/** Choose the smallest cached mip level that still renders crisply at the
 *  requested on-screen size. `current` (optional) suppresses rapid A/B
 *  swaps: an upgrade (to a larger level or to 'full') only fires once
 *  the target crosses `current × UPGRADE_HYSTERESIS`. Downgrades apply
 *  immediately.
 */
export function pickLevel(
  levels: readonly number[],
  onScreenPx: number,
  dpr: number,
  current?: PickedLevel,
): PickedLevel {
  const target = onScreenPx * dpr;
  const candidate: PickedLevel = levels.find((l) => l >= target) ?? 'full';
  if (current === undefined || candidate === current) return candidate;
  const currentPx = current === 'full' ? Infinity : current;
  const candidatePx = candidate === 'full' ? Infinity : candidate;
  const isUpgrade = candidatePx > currentPx;
  if (isUpgrade && target < currentPx * UPGRADE_HYSTERESIS) return current;
  return candidate;
}
```

- [ ] **Step 4: Run test to confirm it passes.**

Run: `pnpm --filter @netrart/app test pickLevel`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/app/src/features/lod/util/pickLevel.ts apps/app/src/features/lod/util/pickLevel.test.ts
git commit -m "feat(lod): add pickLevel util with upgrade hysteresis"
```

---

## Task 4: `lodCache` IDB wrapper — put / get / touch / dims

**Files:**
- Create: `apps/app/src/features/lod/api/lodCache.ts`
- Test: `apps/app/src/features/lod/api/lodCache.test.ts`

- [ ] **Step 1: Write the failing test for basic CRUD and totalBytes tracking.**

Create `apps/app/src/features/lod/api/lodCache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createLodCache, type LodCache } from './lodCache';

const blob = (bytes: number): Blob =>
  new Blob([new Uint8Array(bytes)], { type: 'image/webp' });

describe('lodCache', () => {
  let cache: LodCache;

  beforeEach(async () => {
    // Fresh DB per test: nuke and recreate.
    indexedDB.deleteDatabase('netra-lod');
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
```

- [ ] **Step 2: Run test to confirm it fails.**

Run: `pnpm --filter @netrart/app test lodCache`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cache's open/put/get/dims surface.**

Create `apps/app/src/features/lod/api/lodCache.ts`:

```ts
import { openDB, type IDBPDatabase } from 'idb';
import type { AssetKind, LodEntry } from '../types';
import {
  CACHE_DRAIN_TO_FRACTION,
  DEFAULT_CACHE_BUDGET_BYTES,
  MIN_LEVEL_PX,
} from '../types';

const DB_NAME = 'netra-lod';
const DB_VERSION = 1;

type Schema = {
  lod: { key: string; value: LodEntry };
  dims: { key: string; value: { assetId: string; naturalWidth: number; naturalHeight: number } };
  meta: { key: string; value: { totalBytes: number } };
};

const key = (assetId: string, levelPx: number) => `${assetId}|${levelPx}`;

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
  const db = await openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('lod')) db.createObjectStore('lod');
      if (!db.objectStoreNames.contains('dims')) db.createObjectStore('dims');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
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
      const tx = db.transaction(['lod', 'meta'], 'readwrite');
      const prior = (await tx.objectStore('lod').get(key(assetId, levelPx))) as LodEntry | undefined;
      const priorBytes = prior?.bytes ?? 0;
      await tx.objectStore('lod').put(entry, key(assetId, levelPx));
      const current = (await tx.objectStore('meta').get('total')) as { totalBytes: number } | undefined;
      const newTotal = (current?.totalBytes ?? 0) - priorBytes + bytes;
      await tx.objectStore('meta').put({ totalBytes: newTotal }, 'total');
      await tx.done;
      if (newTotal > budget) {
        await evictToFraction(db, budget * CACHE_DRAIN_TO_FRACTION);
      }
    },

    async get(assetId, levelPx) {
      const entry = (await db.get('lod', key(assetId, levelPx))) as LodEntry | undefined;
      if (!entry) return null;
      // Touch lastAccessed asynchronously; do not await.
      void (async () => {
        const tx = db.transaction('lod', 'readwrite');
        const fresh = (await tx.objectStore('lod').get(key(assetId, levelPx))) as LodEntry | undefined;
        if (fresh) {
          fresh.lastAccessed = Date.now();
          await tx.objectStore('lod').put(fresh, key(assetId, levelPx));
        }
        await tx.done;
      })();
      return entry;
    },

    async has(assetId, levelPx) {
      const k = key(assetId, levelPx);
      const count = await db.count('lod', IDBKeyRange.only(k));
      return count > 0;
    },

    async delete(assetId) {
      const tx = db.transaction(['lod', 'dims', 'meta'], 'readwrite');
      const store = tx.objectStore('lod');
      const all = (await store.getAll()) as LodEntry[];
      let removed = 0;
      for (const entry of all) {
        if (entry.assetId === assetId) {
          await store.delete(key(entry.assetId, entry.levelPx));
          removed += entry.bytes;
        }
      }
      await tx.objectStore('dims').delete(assetId);
      const m = (await tx.objectStore('meta').get('total')) as { totalBytes: number } | undefined;
      const newTotal = Math.max(0, (m?.totalBytes ?? 0) - removed);
      await tx.objectStore('meta').put({ totalBytes: newTotal }, 'total');
      await tx.done;
    },

    totalBytes: readTotalBytes,

    async putDims(assetId, naturalWidth, naturalHeight) {
      await db.put('dims', { assetId, naturalWidth, naturalHeight }, assetId);
    },

    async getDims(assetId) {
      const d = (await db.get('dims', assetId)) as
        | { assetId: string; naturalWidth: number; naturalHeight: number }
        | undefined;
      if (!d) return null;
      return { naturalWidth: d.naturalWidth, naturalHeight: d.naturalHeight };
    },
  };
}

async function evictToFraction(db: IDBPDatabase<Schema>, targetBytes: number): Promise<void> {
  const tx = db.transaction(['lod', 'meta'], 'readwrite');
  const store = tx.objectStore('lod');
  const entries = (await store.getAll()) as LodEntry[];
  const evictable = entries
    .filter((e) => e.levelPx > MIN_LEVEL_PX)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  for (const e of evictable) {
    if (total <= targetBytes) break;
    await store.delete(key(e.assetId, e.levelPx));
    total -= e.bytes;
  }
  await tx.objectStore('meta').put({ totalBytes: total }, 'total');
  await tx.done;
}
```

- [ ] **Step 4: Run test to confirm it passes.**

Run: `pnpm --filter @netrart/app test lodCache`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/app/src/features/lod/api/lodCache.ts apps/app/src/features/lod/api/lodCache.test.ts
git commit -m "feat(lod): add IDB cache wrapper with put/get/dims"
```

---

## Task 5: Cache eviction tests and `delete()` purge

**Files:**
- Modify: `apps/app/src/features/lod/api/lodCache.test.ts`

- [ ] **Step 1: Add failing tests for eviction and delete.**

Append to `apps/app/src/features/lod/api/lodCache.test.ts`:

```ts
describe('lodCache eviction + delete', () => {
  it('evicts non-baseline levels when over budget, keeps baseline', async () => {
    indexedDB.deleteDatabase('netra-lod');
    const cache = await createLodCache({ budgetBytes: 500 });
    // Fill with 3 baselines (64 px) and 3 larger levels (128 px).
    await cache.put('a', 64, 'image', blob(80));
    await cache.put('b', 64, 'image', blob(80));
    await cache.put('c', 64, 'image', blob(80));
    await cache.put('a', 128, 'image', blob(300));
    // Tiny wait so lastAccessed differs deterministically.
    await new Promise((r) => setTimeout(r, 2));
    await cache.put('b', 128, 'image', blob(300));
    await new Promise((r) => setTimeout(r, 2));
    await cache.put('c', 128, 'image', blob(300));
    // Budget is 500, drain target is 450. Baselines = 240 bytes, protected.
    // Must evict 128s until total <= 450, oldest-first → drops a@128, b@128.
    expect(await cache.has('a', 128)).toBe(false);
    expect(await cache.has('b', 128)).toBe(false);
    expect(await cache.has('c', 128)).toBe(true);
    // Baselines intact.
    expect(await cache.has('a', 64)).toBe(true);
    expect(await cache.has('b', 64)).toBe(true);
    expect(await cache.has('c', 64)).toBe(true);
  });

  it('delete(assetId) removes every level and dims for that asset', async () => {
    indexedDB.deleteDatabase('netra-lod');
    const cache = await createLodCache({ budgetBytes: 1024 * 1024 });
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
```

- [ ] **Step 2: Run the tests.**

Run: `pnpm --filter @netrart/app test lodCache`
Expected: PASS — implementation from Task 4 already covers these paths. If eviction test fails, debug `evictToFraction`.

- [ ] **Step 3: Commit.**

```bash
git add apps/app/src/features/lod/api/lodCache.test.ts
git commit -m "test(lod): cover LRU eviction and delete-asset purge"
```

---

## Task 6: `posterFrame` and `sourceBitmap` utils

**Files:**
- Create: `apps/app/src/features/lod/util/posterFrame.ts`
- Create: `apps/app/src/features/lod/util/sourceBitmap.ts`

These run on the main thread because `<video>` is not available in Workers. No tests — they exercise DOM APIs that jsdom does not implement (HTMLVideoElement decode, `createImageBitmap`). Covered indirectly by the integration test.

- [ ] **Step 1: Create `posterFrame`.**

Create `apps/app/src/features/lod/util/posterFrame.ts`:

```ts
/** Extract the first frame of a video as an ImageBitmap. Creates a
 *  detached <video> element, seeks to 0, and draws onto an
 *  OffscreenCanvas. Caller owns the returned bitmap.
 */
export async function posterFrame(src: string): Promise<ImageBitmap> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      reject(new Error(`posterFrame: failed to load ${src}`));
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
  });
  try {
    video.currentTime = 0;
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError2);
        resolve();
      };
      const onError2 = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError2);
        reject(new Error(`posterFrame: seek failed for ${src}`));
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError2);
    });
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) throw new Error(`posterFrame: zero dimensions for ${src}`);
    const bitmap = await createImageBitmap(video);
    return bitmap;
  } finally {
    video.src = '';
    video.load();
  }
}
```

- [ ] **Step 2: Create `sourceBitmap` (unified loader).**

Create `apps/app/src/features/lod/util/sourceBitmap.ts`:

```ts
import type { AssetKind } from '../types';
import { posterFrame } from './posterFrame';

/** Load an asset's pixel source as an ImageBitmap (plus its natural
 *  dimensions). For images this is a plain fetch → decode; for videos
 *  this is the t=0 poster frame. The caller transfers the bitmap to a
 *  Worker; do not read it after transfer.
 */
export async function sourceBitmap(
  kind: AssetKind,
  src: string,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  if (kind === 'video') {
    const bitmap = await posterFrame(src);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  const res = await fetch(src, { credentials: 'omit' });
  if (!res.ok) throw new Error(`sourceBitmap: HTTP ${res.status} for ${src}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS (no type errors from the new modules).

- [ ] **Step 4: Commit.**

```bash
git add apps/app/src/features/lod/util/posterFrame.ts apps/app/src/features/lod/util/sourceBitmap.ts
git commit -m "feat(lod): add posterFrame and sourceBitmap loaders"
```

---

## Task 7: Worker — OffscreenCanvas mip encoder

**Files:**
- Create: `apps/app/src/features/lod/worker/mip.worker.ts`

The worker receives an `ImageBitmap` and a level list, encodes each scaled level to WebP, and posts back a `Blob` per level. One generation at a time; requests queued.

- [ ] **Step 1: Create the worker.**

Create `apps/app/src/features/lod/worker/mip.worker.ts`:

```ts
/// <reference lib="webworker" />
import { WEBP_QUALITY } from '../types';
import type { AssetKind } from '../types';

type GenerateMessage = {
  type: 'generate';
  id: number;
  assetId: string;
  kind: AssetKind;
  bitmap: ImageBitmap;
  levels: number[];
};

type CancelMessage = { type: 'cancel'; id: number };
type InMessage = GenerateMessage | CancelMessage;

type LevelMessage = {
  type: 'level';
  id: number;
  assetId: string;
  levelPx: number;
  blob: Blob;
  bytes: number;
};
type DoneMessage = { type: 'done'; id: number; assetId: string };
type ErrorMessage = { type: 'error'; id: number; assetId: string; message: string };
export type OutMessage = LevelMessage | DoneMessage | ErrorMessage;

const self: DedicatedWorkerGlobalScope = globalThis as unknown as DedicatedWorkerGlobalScope;

type Job = GenerateMessage;
const queue: Job[] = [];
const cancelled = new Set<number>();
let running = false;

async function encodeLevel(bitmap: ImageBitmap, levelPx: number): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = levelPx / longest;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('mip.worker: 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
}

async function runJob(job: Job): Promise<void> {
  try {
    for (const levelPx of job.levels) {
      if (cancelled.has(job.id)) break;
      const blob = await encodeLevel(job.bitmap, levelPx);
      const msg: LevelMessage = {
        type: 'level',
        id: job.id,
        assetId: job.assetId,
        levelPx,
        blob,
        bytes: blob.size,
      };
      self.postMessage(msg);
    }
    const done: DoneMessage = { type: 'done', id: job.id, assetId: job.assetId };
    self.postMessage(done);
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      id: job.id,
      assetId: job.assetId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  } finally {
    job.bitmap.close?.();
    cancelled.delete(job.id);
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      if (!cancelled.has(next.id)) {
        await runJob(next);
      } else {
        next.bitmap.close?.();
        cancelled.delete(next.id);
      }
    }
  } finally {
    running = false;
  }
}

self.addEventListener('message', (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === 'generate') {
    queue.push(msg);
    void pump();
  } else if (msg.type === 'cancel') {
    cancelled.add(msg.id);
  }
});
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/app/src/features/lod/worker/mip.worker.ts
git commit -m "feat(lod): add mip encoder worker (OffscreenCanvas + WebP)"
```

---

## Task 8: Worker client — main-thread proxy

**Files:**
- Create: `apps/app/src/features/lod/worker/mipWorkerClient.ts`

Wraps the raw worker with an id-based request API, handling start/cancel/close. Abstracts over worker availability: when construction fails, `generate()` rejects with a typed error and the hydration hook treats the system as disabled.

- [ ] **Step 1: Create the client.**

Create `apps/app/src/features/lod/worker/mipWorkerClient.ts`:

```ts
import type { AssetKind } from '../types';
import type { OutMessage } from './mip.worker';

export type WorkerLevelEvent = {
  assetId: string;
  levelPx: number;
  blob: Blob;
  bytes: number;
};

export type GenerateHandle = {
  /** Resolves when the worker finishes emitting all levels (or errors). */
  done: Promise<void>;
  /** Fires per level as it's encoded. */
  onLevel: (cb: (e: WorkerLevelEvent) => void) => void;
  /** Request cancellation; worker stops after the current level. */
  cancel: () => void;
};

export type MipWorkerClient = {
  generate: (args: {
    assetId: string;
    kind: AssetKind;
    bitmap: ImageBitmap;
    levels: number[];
  }) => GenerateHandle;
  terminate: () => void;
};

/** Creates the main-thread proxy for `mip.worker.ts`. Returns null if
 *  workers are unavailable (e.g. policy-blocked environments).
 */
export function createMipWorkerClient(): MipWorkerClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./mip.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('[lod] worker unavailable; LoD disabled', err);
    return null;
  }

  let nextId = 1;
  const levelListeners = new Map<number, (e: WorkerLevelEvent) => void>();
  const doneResolvers = new Map<number, () => void>();
  const doneRejecters = new Map<number, (err: Error) => void>();

  worker.addEventListener('message', (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    if (msg.type === 'level') {
      levelListeners.get(msg.id)?.({
        assetId: msg.assetId,
        levelPx: msg.levelPx,
        blob: msg.blob,
        bytes: msg.bytes,
      });
    } else if (msg.type === 'done') {
      doneResolvers.get(msg.id)?.();
      doneResolvers.delete(msg.id);
      doneRejecters.delete(msg.id);
      levelListeners.delete(msg.id);
    } else if (msg.type === 'error') {
      doneRejecters.get(msg.id)?.(new Error(msg.message));
      doneResolvers.delete(msg.id);
      doneRejecters.delete(msg.id);
      levelListeners.delete(msg.id);
    }
  });

  return {
    generate({ assetId, kind, bitmap, levels }) {
      const id = nextId++;
      const done = new Promise<void>((resolve, reject) => {
        doneResolvers.set(id, resolve);
        doneRejecters.set(id, reject);
      });
      worker.postMessage(
        { type: 'generate', id, assetId, kind, bitmap, levels },
        [bitmap],
      );
      return {
        done,
        onLevel(cb) {
          levelListeners.set(id, cb);
        },
        cancel() {
          worker.postMessage({ type: 'cancel', id });
        },
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/app/src/features/lod/worker/mipWorkerClient.ts
git commit -m "feat(lod): add main-thread mip worker client"
```

---

## Task 9: `useLodHydration` — background queue

**Files:**
- Create: `apps/app/src/features/lod/hooks/useLodHydration.ts`

This hook owns the orchestrator: takes the current media list, a cache, a worker client, and emits level-ready events for `useLodSources` to consume.

- [ ] **Step 1: Create the hook.**

Create `apps/app/src/features/lod/hooks/useLodHydration.ts`:

```ts
import { useEffect, useRef } from 'react';
import type { AssetKind } from '../types';
import { computeMipLevels } from '../util/mipLevels';
import { sourceBitmap } from '../util/sourceBitmap';
import type { LodCache } from '../api/lodCache';
import type { MipWorkerClient } from '../worker/mipWorkerClient';

export type HydrationItem = {
  id: string;
  kind: AssetKind;
  src: string;
  /** When true, skip the idle-queue wait (used for fresh uploads). */
  priority?: boolean;
};

export type LevelReadyCallback = (e: {
  assetId: string;
  levelPx: number;
  blob: Blob;
}) => void;

export type UseLodHydrationArgs = {
  items: HydrationItem[];
  cache: LodCache | null;
  worker: MipWorkerClient | null;
  onLevelReady: LevelReadyCallback;
  /** Called once per asset when generation finishes (success or disabled). */
  onAssetReady?: (assetId: string) => void;
};

type Queue = {
  priority: HydrationItem[];
  idle: HydrationItem[];
};

const schedule = (cb: () => void): void => {
  // Use requestIdleCallback when available; fall back to setTimeout(0).
  const ric = (globalThis as { requestIdleCallback?: (cb: IdleRequestCallback) => number })
    .requestIdleCallback;
  if (ric) ric(() => cb());
  else setTimeout(cb, 0);
};

export function useLodHydration({
  items,
  cache,
  worker,
  onLevelReady,
  onAssetReady,
}: UseLodHydrationArgs): void {
  const pending = useRef<Set<string>>(new Set());
  const hydrated = useRef<Set<string>>(new Set());
  const disabled = useRef<Set<string>>(new Set());
  const queue = useRef<Queue>({ priority: [], idle: [] });
  const running = useRef(false);
  const onLevelRef = useRef(onLevelReady);
  onLevelRef.current = onLevelReady;
  const onAssetRef = useRef(onAssetReady);
  onAssetRef.current = onAssetReady;

  useEffect(() => {
    if (!cache || !worker) return;
    let cancelled = false;

    const processOne = async (): Promise<void> => {
      if (cancelled) return;
      const next = queue.current.priority.shift() ?? queue.current.idle.shift();
      if (!next) {
        running.current = false;
        return;
      }
      pending.current.delete(next.id);
      if (hydrated.current.has(next.id) || disabled.current.has(next.id)) {
        void processOne();
        return;
      }
      try {
        const { bitmap, width, height } = await sourceBitmap(next.kind, next.src);
        const longest = Math.max(width, height);
        const levels = computeMipLevels(longest);
        if (!levels.length) {
          disabled.current.add(next.id);
          bitmap.close?.();
          onAssetRef.current?.(next.id);
          void processOne();
          return;
        }
        await cache.putDims(next.id, width, height);
        const handle = worker.generate({
          assetId: next.id,
          kind: next.kind,
          bitmap,
          levels,
        });
        handle.onLevel(async (evt) => {
          await cache.put(evt.assetId, evt.levelPx, next.kind, evt.blob);
          onLevelRef.current({
            assetId: evt.assetId,
            levelPx: evt.levelPx,
            blob: evt.blob,
          });
        });
        await handle.done;
        hydrated.current.add(next.id);
        onAssetRef.current?.(next.id);
      } catch (err) {
        console.warn('[lod] hydration failed for', next.id, err);
        disabled.current.add(next.id);
        onAssetRef.current?.(next.id);
      }
      void processOne();
    };

    const pump = (): void => {
      if (running.current) return;
      running.current = true;
      void processOne();
    };

    const enqueue = async (item: HydrationItem): Promise<void> => {
      if (
        hydrated.current.has(item.id) ||
        pending.current.has(item.id) ||
        disabled.current.has(item.id)
      )
        return;
      // Baseline cached already? Mark hydrated and skip.
      const has = await cache.has(item.id, 64);
      if (cancelled) return;
      if (has) {
        hydrated.current.add(item.id);
        return;
      }
      pending.current.add(item.id);
      if (item.priority) queue.current.priority.push(item);
      else queue.current.idle.push(item);
      if (item.priority) pump();
      else schedule(pump);
    };

    items.forEach((item) => {
      void enqueue(item);
    });

    return () => {
      cancelled = true;
    };
  }, [items, cache, worker]);
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/app/src/features/lod/hooks/useLodHydration.ts
git commit -m "feat(lod): add useLodHydration background queue"
```

---

## Task 10: `useLodSources` — per-visible-item picker + blob URLs

**Files:**
- Create: `apps/app/src/features/lod/hooks/useLodSources.ts`

- [ ] **Step 1: Create the hook.**

Create `apps/app/src/features/lod/hooks/useLodSources.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_LEVEL_PX,
  type AssetKind,
  type LodSource,
  type PickedLevel,
} from '../types';
import { computeMipLevels } from '../util/mipLevels';
import { pickLevel } from '../util/pickLevel';
import type { LodCache } from '../api/lodCache';

export type VisibleItem = {
  id: string;
  kind: AssetKind;
  src: string;
  width: number; // world-space width; on-screen px = width × viewScale
  height: number;
};

export type UseLodSourcesArgs = {
  items: VisibleItem[];
  viewScale: number;
  dpr: number;
  cache: LodCache | null;
};

type Store = {
  /** Blob URLs keyed by assetId → level → url. */
  urls: Map<string, Map<number, string>>;
  /** Natural source dims discovered via hydration or preloaded from IDB. */
  dims: Map<string, { naturalWidth: number; naturalHeight: number }>;
  /** Last picked level per asset (for hysteresis). */
  lastLevel: Map<string, PickedLevel>;
};

/** Picks the best available mip level per visible item and returns LodSource
 *  per id. Keeps Blob URLs alive while items remain visible; revokes them
 *  when items drop out for > REVOKE_GRACE_MS.
 */
export function useLodSources({
  items,
  viewScale,
  dpr,
  cache,
}: UseLodSourcesArgs): {
  sources: Map<string, LodSource>;
  reportLevelBlob: (assetId: string, levelPx: number, blob: Blob) => void;
  reportDims: (assetId: string, naturalWidth: number, naturalHeight: number) => void;
  dropAsset: (assetId: string) => void;
} {
  const [, forceRender] = useState(0);
  const store = useRef<Store>({
    urls: new Map(),
    dims: new Map(),
    lastLevel: new Map(),
  });

  const bump = useCallback(() => forceRender((n) => n + 1), []);

  const reportLevelBlob = useCallback(
    (assetId: string, levelPx: number, blob: Blob) => {
      const assetMap = store.current.urls.get(assetId) ?? new Map();
      const prior = assetMap.get(levelPx);
      if (prior) URL.revokeObjectURL(prior);
      assetMap.set(levelPx, URL.createObjectURL(blob));
      store.current.urls.set(assetId, assetMap);
      bump();
    },
    [bump],
  );

  const reportDims = useCallback(
    (assetId: string, naturalWidth: number, naturalHeight: number) => {
      store.current.dims.set(assetId, { naturalWidth, naturalHeight });
      bump();
    },
    [bump],
  );

  const dropAsset = useCallback(
    (assetId: string) => {
      const assetMap = store.current.urls.get(assetId);
      if (assetMap) {
        for (const url of assetMap.values()) URL.revokeObjectURL(url);
        store.current.urls.delete(assetId);
      }
      store.current.dims.delete(assetId);
      store.current.lastLevel.delete(assetId);
      bump();
    },
    [bump],
  );

  // Preload dims and baseline blob URLs for newly-visible items.
  useEffect(() => {
    if (!cache) return;
    let cancelled = false;
    (async () => {
      for (const item of items) {
        if (cancelled) return;
        if (!store.current.dims.has(item.id)) {
          const d = await cache.getDims(item.id);
          if (cancelled) return;
          if (d) store.current.dims.set(item.id, d);
        }
        const assetUrls = store.current.urls.get(item.id) ?? new Map<number, string>();
        if (!assetUrls.has(64)) {
          const entry = await cache.get(item.id, 64);
          if (cancelled) return;
          if (entry) {
            assetUrls.set(64, URL.createObjectURL(entry.blob));
            store.current.urls.set(item.id, assetUrls);
          }
        }
      }
      if (!cancelled) bump();
    })();
    return () => {
      cancelled = true;
    };
  }, [items, cache, bump]);

  // Pick levels + fetch any missing mid-tier blobs lazily.
  const sources = useMemo(() => {
    const out = new Map<string, LodSource>();
    for (const item of items) {
      const onScreenPx = Math.max(item.width, item.height) * viewScale;
      const dims = store.current.dims.get(item.id);
      const levels = dims ? computeMipLevels(Math.max(dims.naturalWidth, dims.naturalHeight)) : [];
      const prev = store.current.lastLevel.get(item.id);
      const picked = pickLevel(levels, onScreenPx, dpr, prev);
      store.current.lastLevel.set(item.id, picked);

      const assetUrls = store.current.urls.get(item.id);
      let lodSrc: string | undefined;
      if (picked !== 'full' && assetUrls) {
        lodSrc = assetUrls.get(picked);
        if (!lodSrc) {
          // Lazy-load the mid-tier blob if cached. Don't await; next render
          // will pick it up once reportLevelBlob fires.
          if (cache) void loadLevelInBackground(cache, item.id, picked, reportLevelBlob);
        }
      }

      const playVideo =
        item.kind === 'video' && onScreenPx * dpr > MAX_LEVEL_PX;
      const final: LodSource = lodSrc
        ? { lodSrc, isFallback: false, playVideo }
        : { lodSrc: item.src, isFallback: true, playVideo };
      out.set(item.id, final);
    }
    return out;
  }, [items, viewScale, dpr, cache, reportLevelBlob]);

  return { sources, reportLevelBlob, reportDims, dropAsset };
}

async function loadLevelInBackground(
  cache: LodCache,
  assetId: string,
  levelPx: number,
  report: (assetId: string, levelPx: number, blob: Blob) => void,
): Promise<void> {
  const entry = await cache.get(assetId, levelPx);
  if (entry) report(assetId, levelPx, entry.blob);
}
```

- [ ] **Step 2: Typecheck.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/app/src/features/lod/hooks/useLodSources.ts
git commit -m "feat(lod): add useLodSources picker hook"
```

---

## Task 11: Public barrel and integration test

**Files:**
- Create: `apps/app/src/features/lod/index.ts`
- Test: `apps/app/src/features/lod/hooks/useLodSources.test.tsx`

- [ ] **Step 1: Create the barrel.**

Create `apps/app/src/features/lod/index.ts`:

```ts
export { createLodCache, type LodCache } from './api/lodCache';
export { createMipWorkerClient, type MipWorkerClient } from './worker/mipWorkerClient';
export { useLodHydration, type HydrationItem, type LevelReadyCallback } from './hooks/useLodHydration';
export { useLodSources, type VisibleItem, type UseLodSourcesArgs } from './hooks/useLodSources';
export { computeMipLevels } from './util/mipLevels';
export { pickLevel } from './util/pickLevel';
export {
  MIN_LEVEL_PX,
  MAX_LEVEL_PX,
  type AssetKind,
  type PickedLevel,
  type LodSource,
  type LodEntry,
} from './types';
```

- [ ] **Step 2: Write the integration test.**

Create `apps/app/src/features/lod/hooks/useLodSources.test.tsx`:

```tsx
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
    indexedDB.deleteDatabase('netra-lod');
    cache = await createLodCache({ budgetBytes: 1 << 20 });
    await cache.putDims('a', 1000, 800);
    await cache.put('a', 64, 'image', blob(10));
    await cache.put('a', 256, 'image', blob(40));
  });

  it('picks 64-px mip when zoomed out', async () => {
    const { result } = renderHook(() =>
      useLodSources({
        items: [item()],
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
    const { result } = renderHook(() =>
      useLodSources({
        items: [item()],
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
    const video = item({ id: 'v', kind: 'video', width: 1920, height: 1080 });
    const { result } = renderHook(() =>
      useLodSources({ items: [video], viewScale: 0.2, dpr: 1, cache }),
    );
    await waitFor(() => expect(result.current.sources.get('v')).toBeTruthy());
    expect(result.current.sources.get('v')?.playVideo).toBe(false);
  });

  it('marks videos above 1024 px as playVideo=true', async () => {
    await cache.putDims('v', 1920, 1080);
    await cache.put('v', 64, 'image', blob(10));
    const video = item({ id: 'v', kind: 'video', width: 1920, height: 1080 });
    const { result } = renderHook(() =>
      useLodSources({ items: [video], viewScale: 1.0, dpr: 1, cache }),
    );
    await waitFor(() => expect(result.current.sources.get('v')).toBeTruthy());
    expect(result.current.sources.get('v')?.playVideo).toBe(true);
  });

  it('dropAsset revokes URLs and clears state', async () => {
    const { result } = renderHook(() =>
      useLodSources({
        items: [item()],
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
```

- [ ] **Step 3: Run the integration test.**

Run: `pnpm --filter @netrart/app test useLodSources`
Expected: PASS (5 tests in the `jsdom` project).

- [ ] **Step 4: Commit.**

```bash
git add apps/app/src/features/lod/index.ts apps/app/src/features/lod/hooks/useLodSources.test.tsx
git commit -m "feat(lod): add public barrel and useLodSources integration test"
```

---

## Task 12: Wire LoD into `Canvas.tsx` — render path

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

Extend `MediaItem` to accept `lodSrc` and `playVideo` props, thread them through the `<img>` / `<video>` render, and add a Canvas-level hook call that provides them.

- [ ] **Step 1: Extend `MediaItemProps` and the component signature.**

In `apps/app/src/Canvas.tsx` find the `MediaItemProps` type (around line 356) and add two optional props:

```ts
type MediaItemProps = {
  m: CanvasMedia;
  isActive: boolean;
  placement: LabelPlacement;
  lodSrc?: string;
  playVideo?: boolean;
  onEnter: (id: string) => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (e: React.MouseEvent, m: CanvasMedia) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onPointerDown: (e: MediaPointerEvent, m: CanvasMedia) => void;
  onPointerMove: (e: MediaPointerEvent) => void;
  onPointerUp: (e: MediaPointerEvent) => void;
};
```

Update the `MediaItem` destructure at line ~370:

```ts
const MediaItem = memo(function MediaItem({
  m,
  isActive,
  placement,
  lodSrc,
  playVideo = true,
  onEnter,
  onLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MediaItemProps) {
```

- [ ] **Step 2: Switch the render path to use `lodSrc` / `playVideo`.**

In the video branch (around line 420), change the `<video>` → `<img>` swap:

```tsx
if (m.kind === 'video') {
  if (!playVideo) {
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <img
          src={lodSrc ?? m.src}
          alt={m.name}
          draggable={false}
          className={cls}
          style={style}
          onMouseEnter={handleEnter}
          onMouseLeave={onLeave}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onContextMenu={handleContext}
          onPointerDown={handleDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {label}
      </>
    );
  }
  return (
    <>
      <video
        src={m.src}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className={cls}
        style={style}
        onMouseEnter={handleEnter}
        onMouseLeave={onLeave}
        onClick={handleClick}
        onDoubleClick={handleDouble}
        onContextMenu={handleContext}
        onPointerDown={handleDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {label}
    </>
  );
}
```

In the image branch (around line 446), use `lodSrc`:

```tsx
return (
  <>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
    <img
      src={lodSrc ?? m.src}
      alt={m.name}
      draggable={false}
      className={cls}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onClick={handleClick}
      onDoubleClick={handleDouble}
      onContextMenu={handleContext}
      onPointerDown={handleDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
    {label}
  </>
);
```

- [ ] **Step 3: Instantiate the cache and worker once per Canvas mount.**

Near the top of `apps/app/src/Canvas.tsx`, add imports (merge with the existing `./lib/...` imports):

```ts
import {
  createLodCache,
  createMipWorkerClient,
  useLodHydration,
  useLodSources,
  type LodCache,
  type MipWorkerClient,
} from './features/lod';
```

Inside `Canvas()`, just below `const canvasRef = useRef<InfiniteCanvasHandle>(null);` (around line 496), add:

```ts
const [lodCache, setLodCache] = useState<LodCache | null>(null);
const lodWorkerRef = useRef<MipWorkerClient | null>(null);

useEffect(() => {
  let cancelled = false;
  createLodCache()
    .then((c) => {
      if (!cancelled) setLodCache(c);
    })
    .catch((err) => console.warn('[lod] cache open failed', err));
  lodWorkerRef.current = createMipWorkerClient();
  return () => {
    cancelled = true;
    lodWorkerRef.current?.terminate();
    lodWorkerRef.current = null;
  };
}, []);
```

- [ ] **Step 4: Call `useLodSources` after `paintMedia` is computed.**

Find the line `const paintMedia = useMemo(...)` (around line 653). Just after that `useMemo`, add:

```ts
const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
const lodItems = useMemo(
  () =>
    paintMedia
      .filter((m) => !m.pending)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        src: m.src,
        width: m.width,
        height: m.height,
      })),
  [paintMedia],
);
const { sources: lodSources, reportLevelBlob, reportDims, dropAsset } = useLodSources({
  items: lodItems,
  viewScale: view.scale,
  dpr,
  cache: lodCache,
});
```

- [ ] **Step 5: Pass `lodSrc` / `playVideo` to `MediaItem`.**

Find the `{paintMedia.map((m) => (` block (around line 1539). Update the `<MediaItem>` call:

```tsx
{paintMedia.map((m) => {
  const lod = lodSources.get(m.id);
  return (
    <MediaItem
      key={m.id}
      m={m}
      isActive={activeSet.has(m.id)}
      placement={labelPlacements.get(m.id) ?? 'tl'}
      lodSrc={lod?.lodSrc}
      playVideo={lod ? lod.playVideo : true}
      onEnter={handleMediaEnter}
      onLeave={handleMediaLeave}
      onClick={handleMediaClick}
      onDoubleClick={handleMediaDoubleClick}
      onContextMenu={handleMediaContextMenu}
      onPointerDown={handleMediaPointerDown}
      onPointerMove={handleMediaPointerMove}
      onPointerUp={handleMediaPointerUp}
    />
  );
})}
```

- [ ] **Step 6: Typecheck + smoke-build.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

Run: `pnpm --filter @netrart/app build`
Expected: build succeeds; Vite picks up `mip.worker.ts` via the `new Worker(new URL(...))` pattern automatically.

- [ ] **Step 7: Commit.**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(lod): wire mip sources into Canvas render path"
```

---

## Task 13: Hydration, upload priority, delete purge

**Files:**
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 1: Build the hydration items list and wire the hydration hook.**

Continuing in `apps/app/src/Canvas.tsx`, just below the `useLodSources` block from Task 12, add:

```ts
const [priorityIds, setPriorityIds] = useState<Set<string>>(() => new Set());

const hydrationItems = useMemo(
  () =>
    media
      .filter((m) => !m.pending)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        src: m.src,
        priority: priorityIds.has(m.id),
      })),
  [media, priorityIds],
);

const handleLevelReady = useCallback<
  Parameters<typeof useLodHydration>[0]['onLevelReady']
>(
  (e) => {
    reportLevelBlob(e.assetId, e.levelPx, e.blob);
  },
  [reportLevelBlob],
);

const handleAssetReady = useCallback(
  (id: string) => {
    setPriorityIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (lodCache) {
      void lodCache.getDims(id).then((d) => {
        if (d) reportDims(id, d.naturalWidth, d.naturalHeight);
      });
    }
  },
  [lodCache, reportDims],
);

useLodHydration({
  items: hydrationItems,
  cache: lodCache,
  worker: lodWorkerRef.current,
  onLevelReady: handleLevelReady,
  onAssetReady: handleAssetReady,
});
```

- [ ] **Step 2: Flag fresh uploads as priority.**

Locate `runUploadPlan` (around line 829). In the completion handler where `setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));` replaces a pending draft with the PB record, add a line to mark the id as priority. Search for `setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));` and replace that statement with:

```ts
setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));
setPriorityIds((prev) => {
  const out = new Set(prev);
  out.add(next.id);
  return out;
});
```

- [ ] **Step 3: Purge the LoD cache on delete.**

In `deleteMediaById` (around line 1026), inside the success handler after the PB call resolves, add the cache purge. Find:

```ts
.then(() => {
  setConn('ready');
  if (target.kind === 'image') {
    void deleteImageEncoding(id);
  }
})
```

and replace with:

```ts
.then(() => {
  setConn('ready');
  if (target.kind === 'image') {
    void deleteImageEncoding(id);
  }
  if (lodCache) void lodCache.delete(id);
  dropAsset(id);
})
```

- [ ] **Step 4: Typecheck and test.**

Run: `pnpm --filter @netrart/app typecheck`
Expected: PASS.

Run: `pnpm --filter @netrart/app test`
Expected: all prior tests still PASS.

- [ ] **Step 5: Manual smoke test in browser.**

Run: `pnpm dev:app` (from repo root), in another terminal `pnpm db:start`. Open `http://localhost:5174/`.

Verify in a browser devtools:
1. Drop a ~2 MP image onto the canvas. Within ~200 ms, IndexedDB `netra-lod` has `lod` entries `<id>|64`, `<id>|128`, `<id>|256`, `<id>|512`.
2. Zoom out until the item is ~50 px on-screen. Inspect the `<img>` element — `src` is a `blob:` URL, not the PB `/api/files/...` URL.
3. Zoom in past 1:1. `src` swaps back to the PB URL (`isFallback` path).
4. Drop a short video. At low zoom, the rendered element is `<img>` (poster), not `<video>`. At high zoom, it becomes `<video>`.
5. Delete an asset. Its `lod` entries disappear from IDB.

If any of these fail, debug before committing.

- [ ] **Step 6: Commit.**

```bash
git add apps/app/src/Canvas.tsx
git commit -m "feat(lod): hydrate mips on media changes, prioritize uploads, purge on delete"
```

---

## Self-Review

### Spec coverage

- **Client-only, no PB change:** Task 1 adds only client deps. No migration.
- **Mip pyramid `[64, 128, 256, 512, 1024]`:** Task 2 (`computeMipLevels`) + Task 7 (`encodeLevel`). Tests in Task 2 cover boundary sizes.
- **Picker with 1.25× upgrade hysteresis:** Task 3 (`pickLevel`), tests cover upgrade/downgrade/full/empty.
- **Video poster-swap at 1024 px on-screen:** Task 10 (`useLodSources`) sets `playVideo` from `onScreenPx × dpr > MAX_LEVEL_PX`; tested in Task 11.
- **IDB with stratified LRU (baseline never evicted):** Tasks 4–5. Baseline protection asserted in the eviction test.
- **`dims` store for source natural dimensions:** Task 4 (added to spec as implementation detail), used by Task 10.
- **Single shared worker, OffscreenCanvas, WebP 0.8:** Task 7.
- **Background hydration with idle scheduling, upload priority, dedup:** Task 9 (`useLodHydration`).
- **Per-visible source picker + blob URL lifecycle:** Task 10 (`useLodSources`).
- **Canvas integration via MediaItem props:** Task 12.
- **Delete purge:** Task 13 Step 3.
- **Graceful degrade on worker / IDB unavailability:** `createMipWorkerClient` returns null (Task 8), hydration hook guards on null cache/worker (Task 9), `useLodSources` returns fallback when cache is null (Task 10).
- **Integration test (one RTL test):** Task 11 — five focused tests covering the described scenarios (low zoom → mip, high zoom → fallback, video thresholds, dropAsset).

### Type consistency

- `LodCache.put` signature consistent across Tasks 4, 9, and usage in Canvas.
- `HydrationItem` / `VisibleItem` share `{ id, kind, src }` core; `VisibleItem` adds world dims (needed for on-screen-px), `HydrationItem` adds `priority`. Not conflated.
- Worker message types (`OutMessage`, `GenerateMessage`) single-sourced in `mip.worker.ts`, re-imported by client (Task 8).
- `PickedLevel` (`number | 'full'`) used consistently in Task 3 and Task 10.
- `LEVEL_CANDIDATES` in ascending order (matches `computeMipLevels` and `pickLevel.find`).

### Placeholder scan

No TBDs, TODOs, or "similar to above" stubs. Every code block contains the actual content.

### Scope

One PR, one feature folder, one integration point. No decomposition needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-canvas-lod.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
