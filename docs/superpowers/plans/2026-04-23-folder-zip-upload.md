# Folder and Zip Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend canvas drag-and-drop to ingest folders and `.zip` archives (nested zips supported), with a mandatory preview modal gated by soft/hard caps, and Tauri-native folder traversal on the desktop build.

**Architecture:** A single `MediaDescriptor` abstraction unifies three ingestion paths (HTML5 folder/file drop, Tauri native drop, zip extraction). An async-iterable scan pipeline feeds a preview modal; on user confirmation, descriptors are loaded lazily and fed into the existing upload pipeline with a new grid placement. Tauri-native path uses two custom Rust commands (`scan_paths`, `read_file_bytes`) with `dragDropEnabled: true`.

**Tech Stack:** TypeScript, React 18, Vitest, fflate (zip), Tauri v2, Rust std::fs.

**Spec:** `docs/superpowers/specs/2026-04-23-folder-zip-upload-design.md`

---

## File map

**New files**
- `apps/app/src/lib/mediaIngest.ts` — types, constants, classifier, zip extraction, scan functions
- `apps/app/src/lib/mediaIngest.test.ts` — unit tests for pure logic
- `apps/app/src/lib/gridPlacement.ts` — pure grid math
- `apps/app/src/lib/gridPlacement.test.ts` — unit tests
- `apps/app/src/lib/coords.ts` — shared `clientToWorld` (extracted)
- `apps/app/src/lib/tauriDragDrop.ts` — Tauri drag-drop subscription helper
- `apps/app/src/hooks/useImportPreview.ts` — scan lifecycle hook
- `apps/app/src/components/ImportPreviewModal.tsx` — preview dialog

**Modified files**
- `apps/app/src/InfiniteCanvas.tsx` — change drop prop to pass `DataTransfer` + point instead of pre-flattened `File[]`
- `apps/app/src/Canvas.tsx` — wire preview flow, swap row placement for grid, subscribe to Tauri drops
- `apps/app/src/App.css` — modal styles (reuse settings modal tokens)
- `apps/app/package.json` — add `fflate`
- `apps/app/src-tauri/src/lib.rs` — add `scan_paths` + `read_file_bytes` commands
- `apps/app/src-tauri/tauri.conf.json` — `"dragDropEnabled": true`

---

## Task 1: Types, constants, classifier

**Files:**
- Create: `apps/app/src/lib/mediaIngest.ts`
- Create: `apps/app/src/lib/mediaIngest.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/app/src/lib/mediaIngest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifyByExtension,
  SOFT_ITEM_CAP,
  HARD_ITEM_CAP,
  MAX_ZIP_DEPTH,
  MAX_UNCOMPRESSED_BYTES,
  SOFT_SIZE_BYTES,
} from './mediaIngest';

describe('classifyByExtension', () => {
  it('recognizes common image extensions', () => {
    for (const n of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.bmp', 'a.heic', 'a.heif', 'a.svg']) {
      expect(classifyByExtension(n), n).toBe('image');
    }
  });

  it('recognizes common video extensions', () => {
    for (const n of ['a.mp4', 'a.webm', 'a.mov', 'a.m4v', 'a.mkv', 'a.ogv', 'a.avi', 'a.3gp']) {
      expect(classifyByExtension(n), n).toBe('video');
    }
  });

  it('recognizes zip extensions', () => {
    expect(classifyByExtension('a.zip')).toBe('zip');
    expect(classifyByExtension('A.ZIP')).toBe('zip');
  });

  it('returns null for unknown or missing extensions', () => {
    expect(classifyByExtension('a.txt')).toBe(null);
    expect(classifyByExtension('noext')).toBe(null);
    expect(classifyByExtension('')).toBe(null);
  });

  it('is case-insensitive', () => {
    expect(classifyByExtension('FOO.JPG')).toBe('image');
    expect(classifyByExtension('Clip.MP4')).toBe('video');
  });
});

describe('constants', () => {
  it('caps are ordered correctly', () => {
    expect(SOFT_ITEM_CAP).toBeLessThan(HARD_ITEM_CAP);
    expect(SOFT_SIZE_BYTES).toBeLessThan(MAX_UNCOMPRESSED_BYTES);
    expect(MAX_ZIP_DEPTH).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `mediaIngest.ts` with types, constants, and classifier**

```ts
// apps/app/src/lib/mediaIngest.ts

export const SOFT_ITEM_CAP = 500;
export const HARD_ITEM_CAP = 5000;
export const SOFT_SIZE_BYTES = 1 * 1024 ** 3;
export const MAX_UNCOMPRESSED_BYTES = 4 * 1024 ** 3;
export const MAX_ZIP_DEPTH = 4;

export type MediaKind = 'image' | 'video';

export type DescriptorSource =
  | { type: 'file'; file: File }                           // HTML5 File path (direct or from webkitGetAsEntry)
  | { type: 'tauri-path'; absolutePath: string }
  | { type: 'zip-blob'; bytes: Uint8Array };

export type MediaDescriptor = {
  relativePath: string;
  name: string;
  size: number;
  kind: MediaKind;
  mime: string;
  source: DescriptorSource;
  load(): Promise<File>;
};

export type ScanEvent =
  | { type: 'progress'; scanned: number; bytes: number }
  | { type: 'descriptor'; descriptor: MediaDescriptor }
  | { type: 'warning'; code: 'cap-soft'; count: number; bytes: number }
  | { type: 'done' }
  | {
      type: 'error';
      code: 'cap-hard' | 'zip-malformed' | 'aborted' | 'scan-failed';
      message: string;
    };

export type ScanInput = {
  entries: Array<FileSystemEntry | null>;
  fallbackFiles: File[];
};

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi', '3gp',
]);

export function classifyByExtension(name: string): MediaKind | 'zip' | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === 'zip') return 'zip';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function mimeFromExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    m4v: 'video/x-m4v', mkv: 'video/x-matroska', ogv: 'video/ogg',
    avi: 'video/x-msvideo', '3gp': 'video/3gpp',
  };
  return map[ext] ?? '';
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/mediaIngest.ts apps/app/src/lib/mediaIngest.test.ts
git commit -m "feat(ingest): add media classifier, caps, and descriptor types"
```

---

## Task 2: Add fflate and implement recursive zip extraction

**Files:**
- Modify: `apps/app/package.json`
- Modify: `apps/app/src/lib/mediaIngest.ts` (append)
- Modify: `apps/app/src/lib/mediaIngest.test.ts` (append)

- [ ] **Step 1: Install fflate**

Run: `cd apps/app && pnpm add fflate`
Expected: `package.json` updated with `"fflate": "^0.8.x"`.

- [ ] **Step 2: Write failing tests**

Append to `apps/app/src/lib/mediaIngest.test.ts`:

```ts
import { zipSync, strToU8 } from 'fflate';
import {
  extractZipRecursive,
  SizeCapExceededError,
  DepthCapExceededError,
} from './mediaIngest';

const buildZip = (entries: Record<string, Uint8Array>): Uint8Array =>
  zipSync(entries, { level: 0 });

const tinyPng = () =>
  // 1x1 transparent PNG
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

describe('extractZipRecursive', () => {
  it('extracts flat zip of images', () => {
    const zip = buildZip({
      'a.png': tinyPng(),
      'b.png': tinyPng(),
    });
    const out = extractZipRecursive(zip, 'test.zip', 0, {
      bytesUsed: 0,
      limit: MAX_UNCOMPRESSED_BYTES,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.relativePath).toBe('test.zip/a.png');
    expect(out[0]!.kind).toBe('image');
    expect(out[0]!.source.type).toBe('zip-blob');
  });

  it('skips non-media entries silently', () => {
    const zip = buildZip({
      'a.png': tinyPng(),
      'readme.txt': strToU8('hi'),
    });
    const out = extractZipRecursive(zip, 'root', 0, {
      bytesUsed: 0,
      limit: MAX_UNCOMPRESSED_BYTES,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('a.png');
  });

  it('recurses into nested zips and prefixes relativePath', () => {
    const inner = buildZip({ 'deep.png': tinyPng() });
    const outer = buildZip({
      'inner.zip': inner,
      'top.png': tinyPng(),
    });
    const out = extractZipRecursive(outer, 'outer.zip', 0, {
      bytesUsed: 0,
      limit: MAX_UNCOMPRESSED_BYTES,
    });
    expect(out.map((d) => d.relativePath).sort()).toEqual([
      'outer.zip/inner.zip/deep.png',
      'outer.zip/top.png',
    ]);
  });

  it('throws DepthCapExceededError past MAX_ZIP_DEPTH', () => {
    // Build MAX_ZIP_DEPTH + 2 levels of nesting.
    let current = buildZip({ 'leaf.png': tinyPng() });
    for (let i = 0; i < MAX_ZIP_DEPTH + 1; i++) {
      current = buildZip({ 'nested.zip': current });
    }
    expect(() =>
      extractZipRecursive(current, 'root.zip', 0, {
        bytesUsed: 0,
        limit: MAX_UNCOMPRESSED_BYTES,
      }),
    ).toThrow(DepthCapExceededError);
  });

  it('throws SizeCapExceededError when budget exhausted', () => {
    const zip = buildZip({ 'a.png': tinyPng() });
    expect(() =>
      extractZipRecursive(zip, 'root.zip', 0, {
        bytesUsed: MAX_UNCOMPRESSED_BYTES - 10,
        limit: MAX_UNCOMPRESSED_BYTES,
      }),
    ).toThrow(SizeCapExceededError);
  });

  it('descriptor load() returns a File with correct bytes', async () => {
    const zip = buildZip({ 'a.png': tinyPng() });
    const [d] = extractZipRecursive(zip, 'root.zip', 0, {
      bytesUsed: 0,
      limit: MAX_UNCOMPRESSED_BYTES,
    });
    const f = await d!.load();
    expect(f.name).toBe('a.png');
    expect(f.type).toBe('image/png');
    const buf = new Uint8Array(await f.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(tinyPng()));
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: FAIL — `extractZipRecursive` not exported.

- [ ] **Step 4: Implement `extractZipRecursive`**

Append to `apps/app/src/lib/mediaIngest.ts`:

```ts
import { unzipSync } from 'fflate';

export class SizeCapExceededError extends Error {
  constructor(public bytesUsed: number, public limit: number) {
    super(`uncompressed size cap exceeded: ${bytesUsed} > ${limit}`);
    this.name = 'SizeCapExceededError';
  }
}

export class DepthCapExceededError extends Error {
  constructor(public depth: number) {
    super(`zip depth cap exceeded (depth ${depth} > ${MAX_ZIP_DEPTH})`);
    this.name = 'DepthCapExceededError';
  }
}

export type SizeBudget = { bytesUsed: number; limit: number };

export function extractZipRecursive(
  zipBytes: Uint8Array,
  pathPrefix: string,
  depth: number,
  budget: SizeBudget,
): MediaDescriptor[] {
  if (depth > MAX_ZIP_DEPTH) throw new DepthCapExceededError(depth);

  const entries = unzipSync(zipBytes);
  const out: MediaDescriptor[] = [];

  for (const [name, bytes] of Object.entries(entries)) {
    // Directory entries appear as empty zero-length entries ending with '/'.
    if (name.endsWith('/')) continue;

    budget.bytesUsed += bytes.byteLength;
    if (budget.bytesUsed > budget.limit) {
      throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
    }

    const kind = classifyByExtension(name);
    const relativePath = `${pathPrefix}/${name}`;

    if (kind === 'zip') {
      out.push(...extractZipRecursive(bytes, relativePath, depth + 1, budget));
      continue;
    }
    if (kind !== 'image' && kind !== 'video') continue;

    const leaf = name.split('/').pop() ?? name;
    const mime = mimeFromExtension(leaf);
    const capturedBytes = bytes;
    const descriptor: MediaDescriptor = {
      relativePath,
      name: leaf,
      size: bytes.byteLength,
      kind,
      mime,
      source: { type: 'zip-blob', bytes: capturedBytes },
      load: async () =>
        new File(
          [capturedBytes as BlobPart],
          leaf,
          mime ? { type: mime } : undefined,
        ),
    };
    out.push(descriptor);
  }

  return out;
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json apps/app/src/lib/mediaIngest.ts apps/app/src/lib/mediaIngest.test.ts pnpm-lock.yaml
git commit -m "feat(ingest): recursive zip extraction with depth and size caps"
```

---

## Task 3: Grid placement math

**Files:**
- Create: `apps/app/src/lib/gridPlacement.ts`
- Create: `apps/app/src/lib/gridPlacement.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/app/src/lib/gridPlacement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { placeGrid } from './gridPlacement';

const mk = (w: number, h: number) => ({ width: w, height: h });

describe('placeGrid', () => {
  it('single item: centered on anchor (like current single-drop behavior)', () => {
    const items = [mk(200, 100)];
    const out = placeGrid(items, { worldX: 500, worldY: 500 }, 32);
    expect(out).toEqual([
      { x: 500 - 100, y: 500 - 50, width: 200, height: 100 },
    ]);
  });

  it('four items: 2x2 grid with cluster centered on anchor', () => {
    const items = [mk(100, 100), mk(100, 100), mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 10);
    // cell = 110x110, 2 cols, 2 rows, cluster = 220x220, centered on (0,0)
    // first cell top-left at (-110, -110)
    expect(out.map((r) => ({ x: r.x, y: r.y }))).toEqual([
      { x: -110, y: -110 },
      { x: 0, y: -110 },
      { x: -110, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('ten items: 4x3 grid (ceil(sqrt(10))=4 cols, ceil(10/4)=3 rows)', () => {
    const items = Array.from({ length: 10 }, () => mk(50, 50));
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 0);
    // 4 cols, 3 rows, each cell 50x50, cluster 200x150
    expect(out).toHaveLength(10);
    // row 0 cols 0..3 y = -75
    // row 2 has 2 items at cols 0..1 (indexes 8, 9)
    expect(out[0]!.x).toBe(-100);
    expect(out[0]!.y).toBe(-75);
    expect(out[9]!.x).toBe(-50);
    expect(out[9]!.y).toBe(25);
  });

  it('uses max width/height across items for uniform cell size', () => {
    const items = [mk(200, 100), mk(50, 300), mk(100, 100), mk(100, 100)];
    const out = placeGrid(items, { worldX: 0, worldY: 0 }, 0);
    // cell = 200x300, 2x2, cluster = 400x600
    // item 0 at (-200, -300), item 1 at (0, -300), item 2 at (-200, 0), item 3 at (0, 0)
    expect(out[0]).toMatchObject({ x: -200, y: -300, width: 200, height: 100 });
    expect(out[1]).toMatchObject({ x: 0, y: -300, width: 50, height: 300 });
    expect(out[2]).toMatchObject({ x: -200, y: 0, width: 100, height: 100 });
  });

  it('empty input returns empty', () => {
    expect(placeGrid([], { worldX: 0, worldY: 0 }, 32)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd apps/app && pnpm test gridPlacement`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `placeGrid`**

Create `apps/app/src/lib/gridPlacement.ts`:

```ts
type Dims = { width: number; height: number };
type Anchor = { worldX: number; worldY: number };
type PlacedRect = { x: number; y: number; width: number; height: number };

export function placeGrid(
  items: readonly Dims[],
  anchor: Anchor,
  gap: number,
): PlacedRect[] {
  if (items.length === 0) return [];

  const maxW = items.reduce((m, i) => Math.max(m, i.width), 0);
  const maxH = items.reduce((m, i) => Math.max(m, i.height), 0);
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const cellW = maxW + gap;
  const cellH = maxH + gap;
  const clusterW = cols * maxW + (cols - 1) * gap;
  const clusterH = rows * maxH + (rows - 1) * gap;
  const originX = anchor.worldX - clusterW / 2;
  const originY = anchor.worldY - clusterH / 2;

  return items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: originX + col * cellW,
      y: originY + row * cellH,
      width: item.width,
      height: item.height,
    };
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `cd apps/app && pnpm test gridPlacement`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/gridPlacement.ts apps/app/src/lib/gridPlacement.test.ts
git commit -m "feat(canvas): add grid placement helper for multi-item drops"
```

---

## Task 4: Extract shared `clientToWorld` helper

**Files:**
- Create: `apps/app/src/lib/coords.ts`
- Modify: `apps/app/src/InfiniteCanvas.tsx`

- [ ] **Step 1: Create `coords.ts`**

Create `apps/app/src/lib/coords.ts`:

```ts
import type { View, WorldPoint } from '../InfiniteCanvas';

export type ScreenAndWorld = WorldPoint & { screenX: number; screenY: number };

export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  view: View,
): ScreenAndWorld {
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  return {
    screenX,
    screenY,
    worldX: (screenX - view.x) / view.scale,
    worldY: (screenY - view.y) / view.scale,
  };
}
```

- [ ] **Step 2: Update `InfiniteCanvas.tsx` to import from shared helper**

In `apps/app/src/InfiniteCanvas.tsx`:

- Remove the local `clientToWorld` function (lines 16-30).
- Add import: `import { clientToWorld } from './lib/coords';`

- [ ] **Step 3: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Sanity-run existing tests**

Run: `cd apps/app && pnpm test`
Expected: PASS (labelPlacement + gridPlacement + mediaIngest all green).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/coords.ts apps/app/src/InfiniteCanvas.tsx
git commit -m "refactor(canvas): extract clientToWorld into shared helper"
```

---

## Task 5: Web `scanDataTransfer`

**Files:**
- Modify: `apps/app/src/lib/mediaIngest.ts` (append)
- Modify: `apps/app/src/lib/mediaIngest.test.ts` (append)

`scanDataTransfer` uses `FileSystemEntry` APIs which are clumsy to mock. Cover what's unit-testable (the synchronous dispatcher that classifies entries, folds them into a flat list, and handles zips) and rely on the integration pass in Task 12 for the live file-system traversal.

- [ ] **Step 1: Write failing tests for `buildDescriptorFromFile` (helper used by scan)**

Append to `apps/app/src/lib/mediaIngest.test.ts`:

```ts
import { buildDescriptorFromFile } from './mediaIngest';
import { zipSync } from 'fflate';

describe('buildDescriptorFromFile', () => {
  it('image File becomes an image descriptor with working load()', async () => {
    const bytes = tinyPng();
    const f = new File([bytes], 'hi.png', { type: 'image/png' });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = await buildDescriptorFromFile(f, 'folder/hi.png', budget);
    expect(descs).toHaveLength(1);
    expect(descs[0]!.kind).toBe('image');
    expect(descs[0]!.relativePath).toBe('folder/hi.png');
    const out = await descs[0]!.load();
    expect(out.name).toBe('hi.png');
  });

  it('zip File is expanded into its inner descriptors', async () => {
    const inner = zipSync({ 'a.png': tinyPng() }, { level: 0 });
    const f = new File([inner], 'pack.zip', { type: 'application/zip' });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = await buildDescriptorFromFile(f, 'folder/pack.zip', budget);
    expect(descs).toHaveLength(1);
    expect(descs[0]!.relativePath).toBe('folder/pack.zip/a.png');
  });

  it('non-media, non-zip File yields no descriptors', async () => {
    const f = new File(['hi'], 'readme.txt', { type: 'text/plain' });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = await buildDescriptorFromFile(f, 'readme.txt', budget);
    expect(descs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: FAIL — `buildDescriptorFromFile` not exported.

- [ ] **Step 3: Implement `buildDescriptorFromFile` and `scanDataTransfer`**

Append to `apps/app/src/lib/mediaIngest.ts`:

```ts
export async function buildDescriptorFromFile(
  file: File,
  relativePath: string,
  budget: SizeBudget,
): Promise<MediaDescriptor[]> {
  const kind = classifyByExtension(file.name);
  if (kind === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    budget.bytesUsed += bytes.byteLength;
    if (budget.bytesUsed > budget.limit) {
      throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
    }
    return extractZipRecursive(bytes, relativePath, 1, budget);
  }
  if (kind !== 'image' && kind !== 'video') return [];

  budget.bytesUsed += file.size;
  if (budget.bytesUsed > budget.limit) {
    throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
  }

  const mime = file.type || mimeFromExtension(file.name);
  const descriptor: MediaDescriptor = {
    relativePath,
    name: file.name,
    size: file.size,
    kind,
    mime,
    source: { type: 'file', file },
    load: async () => file,
  };
  return [descriptor];
}

// ScanInput is declared in Task 1's type block. captureDataTransfer
// produces it synchronously from DataTransfer.items before the drop
// event's DataTransfer handle becomes unusable.

export function captureDataTransfer(dt: DataTransfer): ScanInput {
  const entries: Array<FileSystemEntry | null> = [];
  const fallbackFiles: File[] = [];
  // Iterating DataTransferItemList synchronously — must not await.
  for (let i = 0; i < dt.items.length; i++) {
    const it = dt.items[i];
    if (!it || it.kind !== 'file') continue;
    const entry = typeof it.webkitGetAsEntry === 'function'
      ? it.webkitGetAsEntry()
      : null;
    if (entry) {
      entries.push(entry);
    } else {
      const f = it.getAsFile();
      if (f) fallbackFiles.push(f);
    }
  }
  return { entries, fallbackFiles };
}

export function dropContainsFolderOrZip(input: ScanInput): boolean {
  for (const e of input.entries) {
    if (!e) continue;
    if (e.isDirectory) return true;
    if (classifyByExtension(e.name) === 'zip') return true;
  }
  for (const f of input.fallbackFiles) {
    if (classifyByExtension(f.name) === 'zip') return true;
  }
  return false;
}

async function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const out: FileSystemEntry[] = [];
  // FileSystemDirectoryReader.readEntries can return a bounded batch; must
  // call repeatedly until it yields an empty array.
  for (;;) {
    const batch: FileSystemEntry[] = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

const entryToFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  budget: SizeBudget,
  signal: AbortSignal,
  emit: (d: MediaDescriptor) => void,
  progress: (bytes: number) => void,
): Promise<void> {
  if (signal.aborted) return;
  const nextPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      if (signal.aborted) return;
      await walkEntry(child, nextPath, budget, signal, emit, progress);
    }
    return;
  }
  if (!entry.isFile) return;
  const file = await entryToFile(entry as FileSystemFileEntry);
  const descs = await buildDescriptorFromFile(file, nextPath, budget);
  for (const d of descs) {
    emit(d);
    progress(d.size);
  }
}

export async function* scanDataTransfer(
  captured: ScanInput,
  signal: AbortSignal,
): AsyncGenerator<ScanEvent> {
  const budget: SizeBudget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
  const queue: MediaDescriptor[] = [];
  let scanned = 0;
  let bytes = 0;
  let softWarned = false;

  const emit = (d: MediaDescriptor) => {
    queue.push(d);
    scanned++;
    bytes += d.size;
  };
  const bumpProgress = (_size: number) => {};

  try {
    for (const f of captured.fallbackFiles) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const descs = await buildDescriptorFromFile(f, f.name, budget);
      for (const d of descs) emit(d);
    }
    for (const entry of captured.entries) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (!entry) continue;
      await walkEntry(entry, '', budget, signal, emit, bumpProgress);
    }

    // Drain the queue as ScanEvents. We emit everything after the walk
    // completes; for the hook, this is still effectively streaming because
    // the generator is awaited.
    for (const d of queue) {
      yield { type: 'descriptor', descriptor: d };
      if (scanned > HARD_ITEM_CAP) {
        yield {
          type: 'error',
          code: 'cap-hard',
          message: `Too many files (${scanned}). Please split into smaller batches.`,
        };
        return;
      }
      if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
        softWarned = true;
        yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
      }
      yield { type: 'progress', scanned, bytes };
    }
    yield { type: 'done' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
      return;
    }
    if (err instanceof SizeCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-hard',
        message: `Archive exceeds the ${(budget.limit / 1024 ** 3).toFixed(0)} GB uncompressed limit.`,
      };
      return;
    }
    if (err instanceof DepthCapExceededError) {
      yield {
        type: 'error',
        code: 'zip-malformed',
        message: `Zip nesting exceeds ${MAX_ZIP_DEPTH} levels.`,
      };
      return;
    }
    yield {
      type: 'error',
      code: 'scan-failed',
      message: (err as Error).message || 'scan failed',
    };
  }
}
```

(The `source: { type: 'file', file }` discriminant lets downstream code tell a direct-file descriptor from a zip-blob or Tauri-path descriptor if needed; `load()` returns the File from closure either way.)

- [ ] **Step 4: Run tests, confirm pass**

Run: `cd apps/app && pnpm test mediaIngest`
Expected: PASS (all classifier, extract, and buildDescriptorFromFile tests green).

- [ ] **Step 5: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/mediaIngest.ts apps/app/src/lib/mediaIngest.test.ts
git commit -m "feat(ingest): scan DataTransfer folders and zips into descriptor stream"
```

---

## Task 6: `useImportPreview` hook

**Files:**
- Create: `apps/app/src/hooks/useImportPreview.ts`

- [ ] **Step 1: Create the hook**

Create `apps/app/src/hooks/useImportPreview.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import {
  scanDataTransfer,
  type MediaDescriptor,
  type ScanEvent,
  type ScanInput,
} from '../lib/mediaIngest';

export type ImportState = {
  open: boolean;
  phase: 'scanning' | 'ready' | 'error';
  descriptors: MediaDescriptor[];
  bytes: number;
  imageCount: number;
  videoCount: number;
  warning?: { code: 'cap-soft'; message: string };
  error?: {
    code: 'cap-hard' | 'zip-malformed' | 'scan-failed' | 'aborted';
    message: string;
  };
  sourceLabel: string;
};

export type ScanSource =
  | { kind: 'data-transfer'; captured: ScanInput; label: string }
  | {
      kind: 'generator';
      label: string;
      makeGenerator: (signal: AbortSignal) => AsyncGenerator<ScanEvent>;
    };

const EMPTY: ImportState = {
  open: false,
  phase: 'ready',
  descriptors: [],
  bytes: 0,
  imageCount: 0,
  videoCount: 0,
  sourceLabel: '',
};

export function useImportPreview() {
  const [state, setState] = useState<ImportState>(EMPTY);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(EMPTY);
  }, []);

  const start = useCallback(async (source: ScanSource) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({
      ...EMPTY,
      open: true,
      phase: 'scanning',
      sourceLabel: source.label,
    });

    const gen: AsyncGenerator<ScanEvent> =
      source.kind === 'data-transfer'
        ? scanDataTransfer(source.captured, controller.signal)
        : source.makeGenerator(controller.signal);

    try {
      for await (const event of gen) {
        if (controller.signal.aborted) return;
        setState((prev) => applyEvent(prev, event));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: {
          code: 'scan-failed',
          message: (err as Error).message || 'scan failed',
        },
      }));
    }
  }, []);

  return { state, start, cancel };
}

function applyEvent(prev: ImportState, event: ScanEvent): ImportState {
  switch (event.type) {
    case 'descriptor': {
      const next = {
        ...prev,
        descriptors: [...prev.descriptors, event.descriptor],
        bytes: prev.bytes + event.descriptor.size,
        imageCount:
          prev.imageCount + (event.descriptor.kind === 'image' ? 1 : 0),
        videoCount:
          prev.videoCount + (event.descriptor.kind === 'video' ? 1 : 0),
      };
      return next;
    }
    case 'progress':
      return prev; // counts already updated via descriptor events
    case 'warning':
      return {
        ...prev,
        warning: {
          code: 'cap-soft',
          message: `This will import ${event.count} items (~${humanSize(event.bytes)}). Uploads may take several minutes.`,
        },
      };
    case 'done':
      return { ...prev, phase: 'ready' };
    case 'error':
      return {
        ...prev,
        phase: 'error',
        error: { code: event.code, message: event.message },
      };
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/hooks/useImportPreview.ts
git commit -m "feat(canvas): add useImportPreview scan-lifecycle hook"
```

---

## Task 7: `ImportPreviewModal` component

**Files:**
- Create: `apps/app/src/components/ImportPreviewModal.tsx`

- [ ] **Step 1: Create the component**

Create `apps/app/src/components/ImportPreviewModal.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ImportState } from '../hooks/useImportPreview';
import { humanSize } from '../hooks/useImportPreview';

type Props = {
  state: ImportState;
  onCancel: () => void;
  onImport: () => void;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ImportPreviewModal({ state, onCancel, onImport }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!state.open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [state.open]);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && canImport(state)) {
        e.preventDefault();
        onImport();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const f = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onCancel, onImport]);

  if (!state.open) return null;

  const total = state.imageCount + state.videoCount;
  const summary =
    state.phase === 'scanning' && total === 0
      ? 'Scanning…'
      : `${state.imageCount} images · ${state.videoCount} videos · ${humanSize(state.bytes)}`;

  const headerTitle =
    state.phase === 'scanning' && total === 0
      ? `Scanning ${state.sourceLabel}`
      : `Import ${total} item${total === 1 ? '' : 's'} from ${state.sourceLabel}`;

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={cardRef}
        className="settings-card import-preview-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preview-title"
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2 id="import-preview-title" className="settings-title">
            {headerTitle}
          </h2>
          <button
            type="button"
            className="settings-close"
            aria-label="Cancel import"
            onClick={onCancel}
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>

        <div className="settings-body import-preview-body">
          <div className="import-preview-summary">{summary}</div>

          {state.warning && (
            <div className="import-preview-banner is-warning" role="alert">
              <i className="ri-alert-line" aria-hidden />
              <span>{state.warning.message}</span>
            </div>
          )}

          {state.error && (
            <div className="import-preview-banner is-error" role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              <span>{state.error.message}</span>
            </div>
          )}

          <ul className="import-preview-list" role="list">
            {state.descriptors.map((d) => (
              <li key={d.relativePath} className="import-preview-row">
                <i
                  className={
                    d.kind === 'video'
                      ? 'ri-film-line'
                      : 'ri-image-line'
                  }
                  aria-hidden
                />
                <span className="import-preview-path">{d.relativePath}</span>
                <span className="import-preview-size">{humanSize(d.size)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="settings-footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-ghost btn-primary"
            onClick={onImport}
            disabled={!canImport(state)}
          >
            {state.phase === 'scanning' ? 'Scanning…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function canImport(state: ImportState): boolean {
  return (
    state.phase === 'ready' &&
    !state.error &&
    state.descriptors.length > 0
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/ImportPreviewModal.tsx
git commit -m "feat(canvas): add import preview modal for folder and zip drops"
```

---

## Task 8: Wire web path into Canvas (with grid placement)

**Files:**
- Modify: `apps/app/src/InfiniteCanvas.tsx`
- Modify: `apps/app/src/Canvas.tsx`

- [ ] **Step 1: Change `InfiniteCanvas` drop prop to pass raw DataTransfer**

In `apps/app/src/InfiniteCanvas.tsx`:

- Replace the `onFilesDrop` prop type with:

```ts
onDataTransferDrop?: (dt: DataTransfer, worldPoint: WorldPoint) => void;
```

- In the component body, destructure `onDataTransferDrop` instead of `onFilesDrop`.
- Update `onDrop` handler:

```ts
const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth.current = 0;
  setDragOver(false);
  if (!onDataTransferDrop) return;
  const rect = containerRef.current?.getBoundingClientRect();
  if (!rect) return;
  const wp = clientToWorld(e.clientX, e.clientY, rect, viewRef.current);
  onDataTransferDrop(e.dataTransfer, { worldX: wp.worldX, worldY: wp.worldY });
};
```

- [ ] **Step 2: Update `Canvas.tsx` imports**

At the top of `apps/app/src/Canvas.tsx`, add:

```ts
import {
  captureDataTransfer,
  dropContainsFolderOrZip,
  type MediaDescriptor,
} from './lib/mediaIngest';
import { placeGrid } from './lib/gridPlacement';
import { useImportPreview } from './hooks/useImportPreview';
import { ImportPreviewModal } from './components/ImportPreviewModal';
```

- [ ] **Step 3: Rename and rewrite `handleFilesDrop`**

In `apps/app/src/Canvas.tsx`, replace the `handleFilesDrop` implementation (currently at lines ~1160-1221) with two handlers:

```ts
const importDescriptors = useCallback(
  async (descriptors: MediaDescriptor[], point: WorldPoint) => {
    // Resolve each descriptor to a File. Descriptors own the lazy load.
    const files: { file: File; kind: 'image' | 'video' }[] = [];
    for (const d of descriptors) {
      try {
        const f = await d.load();
        files.push({ file: f, kind: d.kind });
      } catch (err) {
        console.error('[ingest] load failed', d.relativePath, err);
      }
    }
    if (!files.length) return;

    const rawLoaded = await Promise.all(
      files.map(async ({ file, kind }) => {
        const dims = await (kind === 'video' ? loadVideo(file) : loadImage(file));
        return { file, kind, ...dims };
      }),
    );

    const reference = mediaRef.current.filter((m) => !m.pending);
    const loaded = rawLoaded.map((l) => ({
      ...l,
      ...normalizeUploadSize({ width: l.width, height: l.height }, reference),
    }));

    const gap = 32;
    const placements = placeGrid(
      loaded.map((l) => ({ width: l.width, height: l.height })),
      point,
      gap,
    );

    const plan: UploadPlan[] = loaded.map((l, i) => {
      const r = placements[i]!;
      const meta = {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        name: l.file.name,
      };
      return {
        draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
        file: l.file,
        meta,
      };
    });

    const minX = Math.min(...plan.map((p) => p.draft.x));
    const minY = Math.min(...plan.map((p) => p.draft.y));
    const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
    const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));

    const uploading = runUploadPlan(plan);
    canvasRef.current?.focusOn(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
    );
    await uploading;
  },
  [runUploadPlan],
);

const pendingPointRef = useRef<WorldPoint | null>(null);
const preview = useImportPreview();

const handleDrop = useCallback(
  (dt: DataTransfer, point: WorldPoint) => {
    const captured = captureDataTransfer(dt);
    if (captured.entries.length === 0 && captured.fallbackFiles.length === 0) {
      return;
    }
    const requiresPreview = dropContainsFolderOrZip(captured);
    if (!requiresPreview) {
      // Plain files path: build descriptors inline and import directly.
      // buildDescriptorFromFile handles classification; a non-media file
      // just yields no descriptor.
      void (async () => {
        const budget = { bytesUsed: 0, limit: Number.MAX_SAFE_INTEGER };
        const descs: MediaDescriptor[] = [];
        for (const f of captured.fallbackFiles) {
          const d = await import('./lib/mediaIngest').then((m) =>
            m.buildDescriptorFromFile(f, f.name, budget),
          );
          descs.push(...d);
        }
        if (descs.length) await importDescriptors(descs, point);
      })();
      return;
    }

    pendingPointRef.current = point;
    const label = describeDrop(captured);
    void preview.start({ kind: 'data-transfer', captured, label });
  },
  [preview, importDescriptors],
);

const onConfirmImport = useCallback(() => {
  const point = pendingPointRef.current;
  pendingPointRef.current = null;
  const descs = preview.state.descriptors;
  preview.cancel(); // closes modal, clears state
  if (point && descs.length) void importDescriptors(descs, point);
}, [importDescriptors, preview]);
```

Add a helper above the component (alongside other local helpers):

```ts
import type { ScanInput } from './lib/mediaIngest';

function describeDrop(captured: ScanInput): string {
  const first =
    captured.entries.find((e) => e && e.isDirectory)?.name ??
    captured.fallbackFiles.find((f) => /\.zip$/i.test(f.name))?.name ??
    captured.entries[0]?.name ??
    captured.fallbackFiles[0]?.name;
  const count = captured.entries.length + captured.fallbackFiles.length;
  if (count <= 1 && first) return first;
  return `${count} sources`;
}
```

- [ ] **Step 4: Render the modal and update the InfiniteCanvas prop**

In `Canvas.tsx`:

- Change the `<InfiniteCanvas ... onFilesDrop={handleFilesDrop}>` prop to `onDataTransferDrop={handleDrop}`.
- Near the other modals/HUD markup (e.g., next to `<SettingsModal ...>`), add:

```tsx
<ImportPreviewModal
  state={preview.state}
  onCancel={preview.cancel}
  onImport={onConfirmImport}
/>
```

- Remove the old `handleFilesDrop` definition.

- [ ] **Step 5: Typecheck and test**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke test in web debug build**

Run: `cd /Users/rbisri/Documents/netrart && pnpm db:start` in one terminal and `pnpm dev:app` in another. Open `http://localhost:5174/`.

Verify:
1. Drop a single image → no modal, image uploads (unchanged behavior).
2. Drop two images at once → no modal, both upload as 1x2 grid centered on drop point.
3. Drop a folder containing 5 mixed images/videos → modal opens, list appears, Import uploads them in a grid.
4. Drop a `.zip` containing 3 images → modal opens, list shows entries with zip prefix, Import works.
5. Escape during modal → closes without uploading.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/InfiniteCanvas.tsx apps/app/src/Canvas.tsx
git commit -m "feat(canvas): ingest folders, zips, and multi-file drops with preview"
```

---

## Task 9: Modal styles

**Files:**
- Modify: `apps/app/src/App.css`

- [ ] **Step 1: Append styles**

Append to `apps/app/src/App.css`:

```css
.import-preview-card {
  width: min(640px, 92vw);
  max-height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
}

.import-preview-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.import-preview-summary {
  font-size: 13px;
  color: var(--text-muted, #666);
}

.import-preview-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.import-preview-banner.is-warning {
  background: color-mix(in srgb, #f5a623 18%, transparent);
  color: #a06200;
}

.import-preview-banner.is-error {
  background: color-mix(in srgb, #e04f4f 18%, transparent);
  color: #a01818;
}

.import-preview-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--surface-muted, rgba(0, 0, 0, 0.02));
}

.import-preview-row {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.05));
}

.import-preview-row:last-child {
  border-bottom: 0;
}

.import-preview-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.import-preview-size {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted, #666);
}
```

- [ ] **Step 2: Manual visual check**

Run the web debug build, drop a folder, confirm the modal is legible in both light and dark modes (toggle via Settings).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/App.css
git commit -m "style(canvas): import preview modal styles"
```

---

## Task 10: Tauri Rust commands and drag-drop flip

**Files:**
- Modify: `apps/app/src-tauri/tauri.conf.json`
- Modify: `apps/app/src-tauri/src/lib.rs`

- [ ] **Step 1: Flip `dragDropEnabled`**

In `apps/app/src-tauri/tauri.conf.json`, change:

```json
"dragDropEnabled": false
```

to:

```json
"dragDropEnabled": true
```

- [ ] **Step 2: Add Rust commands**

Append to `apps/app/src-tauri/src/lib.rs`, above the `pub fn run()` function:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryInfo {
    absolute_path: String,
    relative_path: String,
    size: u64,
    extension: String,
}

fn is_supported_ext(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "heic" | "heif" | "svg" |
        "mp4" | "webm" | "mov" | "m4v" | "mkv" | "ogv" | "avi" | "3gp" |
        "zip"
    )
}

fn walk_into(
    root_name: &str,
    absolute: &std::path::Path,
    out: &mut Vec<EntryInfo>,
) -> std::io::Result<()> {
    let meta = std::fs::metadata(absolute)?;
    if meta.is_file() {
        let ext = absolute
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if !is_supported_ext(&ext) {
            return Ok(());
        }
        let relative = root_name.to_string();
        out.push(EntryInfo {
            absolute_path: absolute.to_string_lossy().to_string(),
            relative_path: relative,
            size: meta.len(),
            extension: ext,
        });
        return Ok(());
    }
    if !meta.is_dir() {
        return Ok(());
    }
    // Recurse directory; relative path is prefixed with the root's file
    // name plus each entry's relative component.
    fn walk_dir(
        prefix: &str,
        dir: &std::path::Path,
        out: &mut Vec<EntryInfo>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let next_prefix = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk_dir(&next_prefix, &path, out)?;
            } else if ft.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !is_supported_ext(&ext) {
                    continue;
                }
                let size = std::fs::metadata(&path)?.len();
                out.push(EntryInfo {
                    absolute_path: path.to_string_lossy().to_string(),
                    relative_path: next_prefix,
                    size,
                    extension: ext,
                });
            }
        }
        Ok(())
    }
    walk_dir(root_name, absolute, out)?;
    Ok(())
}

#[tauri::command]
fn scan_paths(paths: Vec<String>) -> Result<Vec<EntryInfo>, String> {
    let mut out = Vec::new();
    for p in paths {
        let path = std::path::PathBuf::from(&p);
        let root_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| p.clone());
        walk_into(&root_name, &path, &mut out).map_err(|e| format!("scan {p}: {e}"))?;
    }
    Ok(out)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))
}
```

Register the new commands by extending the `generate_handler!` list:

```rust
.invoke_handler(tauri::generate_handler![
    pb_url,
    sam3_version,
    sam3_warmup,
    sam3_encode_image,
    sam3_delete_image_cache,
    sam3_cache_status,
    sam3_segment_text,
    scan_paths,
    read_file_bytes,
])
```

- [ ] **Step 3: Compile Rust**

Run: `cd apps/app/src-tauri && cargo check`
Expected: PASS, no warnings related to the new commands.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src-tauri/src/lib.rs apps/app/src-tauri/tauri.conf.json
git commit -m "feat(tauri): add scan_paths and read_file_bytes commands"
```

---

## Task 11: Tauri frontend — subscription and scan

**Files:**
- Create: `apps/app/src/lib/tauriDragDrop.ts`
- Modify: `apps/app/src/lib/mediaIngest.ts` (append `scanTauriPaths`)
- Modify: `apps/app/src/Canvas.tsx` (subscribe)

- [ ] **Step 1: Create the subscription helper**

Create `apps/app/src/lib/tauriDragDrop.ts`:

```ts
import { getCurrentWebview } from '@tauri-apps/api/webview';

export type TauriDropPayload = {
  paths: string[];
  position: { x: number; y: number }; // physical pixels
};

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function subscribeTauriDrops(
  handler: (payload: TauriDropPayload) => void,
): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const webview = getCurrentWebview();
      const unsub = await webview.onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        const payload = event.payload as unknown as {
          type: 'drop';
          paths: string[];
          position: { x: number; y: number };
        };
        handler({ paths: payload.paths, position: payload.position });
      });
      if (cancelled) unsub();
      else unlisten = unsub;
    } catch (err) {
      console.error('[tauri-drop] subscribe failed', err);
    }
  })();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
```

- [ ] **Step 2: Add `scanTauriPaths` to `mediaIngest.ts`**

Append to `apps/app/src/lib/mediaIngest.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

type TauriEntryInfo = {
  absolutePath: string;
  relativePath: string;
  size: number;
  extension: string;
};

function descriptorFromTauriEntry(
  entry: TauriEntryInfo,
): MediaDescriptor | null {
  const kind = classifyByExtension(entry.relativePath);
  if (kind !== 'image' && kind !== 'video') return null;
  const leaf = entry.relativePath.split('/').pop() ?? entry.relativePath;
  const mime = mimeFromExtension(leaf);
  return {
    relativePath: entry.relativePath,
    name: leaf,
    size: entry.size,
    kind,
    mime,
    source: { type: 'tauri-path', absolutePath: entry.absolutePath },
    load: async () => {
      const bytes = (await invoke<number[] | Uint8Array>('read_file_bytes', {
        path: entry.absolutePath,
      })) as unknown as ArrayLike<number>;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return new File([u8], leaf, mime ? { type: mime } : undefined);
    },
  };
}

export async function* scanTauriPaths(
  paths: string[],
  signal: AbortSignal,
): AsyncGenerator<ScanEvent> {
  const budget: SizeBudget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
  let scanned = 0;
  let bytes = 0;
  let softWarned = false;

  try {
    const entries = (await invoke<TauriEntryInfo[]>('scan_paths', {
      paths,
    })) as TauriEntryInfo[];
    if (signal.aborted) {
      yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
      return;
    }

    for (const entry of entries) {
      if (signal.aborted) {
        yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
        return;
      }

      const kind = classifyByExtension(entry.relativePath);
      if (kind === 'zip') {
        const rawBytes = (await invoke<number[] | Uint8Array>('read_file_bytes', {
          path: entry.absolutePath,
        })) as unknown as ArrayLike<number>;
        const u8 =
          rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
        budget.bytesUsed += u8.byteLength;
        if (budget.bytesUsed > budget.limit) {
          yield {
            type: 'error',
            code: 'cap-hard',
            message: `Archive exceeds the ${(budget.limit / 1024 ** 3).toFixed(0)} GB uncompressed limit.`,
          };
          return;
        }
        const inner = extractZipRecursive(u8, entry.relativePath, 1, budget);
        for (const d of inner) {
          scanned++;
          bytes += d.size;
          yield { type: 'descriptor', descriptor: d };
          if (scanned > HARD_ITEM_CAP) {
            yield {
              type: 'error',
              code: 'cap-hard',
              message: `Too many files (${scanned}).`,
            };
            return;
          }
          if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
            softWarned = true;
            yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
          }
        }
        continue;
      }

      const d = descriptorFromTauriEntry(entry);
      if (!d) continue;
      scanned++;
      bytes += d.size;
      yield { type: 'descriptor', descriptor: d };
      if (scanned > HARD_ITEM_CAP) {
        yield {
          type: 'error',
          code: 'cap-hard',
          message: `Too many files (${scanned}).`,
        };
        return;
      }
      if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
        softWarned = true;
        yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
      }
    }
    yield { type: 'done' };
  } catch (err) {
    if (err instanceof DepthCapExceededError) {
      yield {
        type: 'error',
        code: 'zip-malformed',
        message: `Zip nesting exceeds ${MAX_ZIP_DEPTH} levels.`,
      };
      return;
    }
    if (err instanceof SizeCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-hard',
        message: `Archive exceeds the ${(budget.limit / 1024 ** 3).toFixed(0)} GB uncompressed limit.`,
      };
      return;
    }
    yield {
      type: 'error',
      code: 'scan-failed',
      message: (err as Error).message || 'scan failed',
    };
  }
}
```

- [ ] **Step 3: Subscribe in `Canvas.tsx`**

In `apps/app/src/Canvas.tsx`, add an effect (near the other mount effects):

```ts
import { subscribeTauriDrops } from './lib/tauriDragDrop';
import { scanTauriPaths } from './lib/mediaIngest';

// ... inside the component:
useEffect(() => {
  return subscribeTauriDrops(({ paths, position }) => {
    if (!paths.length) return;
    const rect = document.documentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const clientX = position.x / dpr;
    const clientY = position.y / dpr;
    const view = canvasRef.current?.getView();
    if (!view) return;
    const worldX = (clientX - rect.left - view.x) / view.scale;
    const worldY = (clientY - rect.top - view.y) / view.scale;
    const point: WorldPoint = { worldX, worldY };
    pendingPointRef.current = point;

    // Decide whether to preview: anything that's a folder
    // (no extension or an unknown extension from the top-level path) or
    // a zip triggers preview. Multiple top-level paths always preview.
    const looksLikeFolderOrZip = paths.length > 1 || paths.some((p) => {
      const leaf = p.split(/[\\/]/).pop() ?? p;
      const ext = leaf.includes('.')
        ? leaf.slice(leaf.lastIndexOf('.') + 1).toLowerCase()
        : '';
      return ext === '' || ext === 'zip';
    });

    if (!looksLikeFolderOrZip) {
      // Single plain file — bypass preview, load directly.
      void (async () => {
        const { buildDescriptorFromFile } = await import('./lib/mediaIngest');
        // Read the one file and wrap it.
        const path = paths[0]!;
        const bytes = (await invoke<number[] | Uint8Array>(
          'read_file_bytes',
          { path },
        )) as unknown as ArrayLike<number>;
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const leaf = path.split(/[\\/]/).pop() ?? path;
        const file = new File([u8], leaf);
        const budget = { bytesUsed: 0, limit: Number.MAX_SAFE_INTEGER };
        const descs = await buildDescriptorFromFile(file, leaf, budget);
        if (descs.length) await importDescriptors(descs, point);
      })();
      return;
    }

    const label =
      paths.length === 1
        ? (paths[0]!.split(/[\\/]/).pop() ?? paths[0]!)
        : `${paths.length} sources`;
    void preview.start({
      kind: 'generator',
      label,
      makeGenerator: (signal) => scanTauriPaths(paths, signal),
    });
  });
}, [preview, importDescriptors]);
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Manual test in Tauri**

Run: `cd /Users/rbisri/Documents/netrart && pnpm tauri:dev`

Verify:
1. Drop a single image from Finder → no modal, image uploads.
2. Drop a folder of 5 images → modal opens (via `scan_paths`), list shows relative paths, Import uploads as a grid.
3. Drop a `.zip` from Finder → modal opens, inner entries listed with `name.zip/...` prefix, Import uploads.
4. Drop a folder containing a zip containing images → modal flattens all entries.
5. Confirm the HTML5 drop handler in `InfiniteCanvas.tsx` never fires in Tauri (console log a marker if helpful during verification).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/tauriDragDrop.ts apps/app/src/lib/mediaIngest.ts apps/app/src/Canvas.tsx
git commit -m "feat(tauri): native drag-drop scan with scan_paths + read_file_bytes"
```

---

## Task 12: Integration pass + fixes

**Files:** (as needed)

Run through the full verification matrix from the spec. Fix any regressions encountered.

- [ ] **Step 1: Web debug build verification**

Run: `pnpm db:start` + `pnpm dev:app`. Check:

- [ ] Single image drop → no modal, uploads (regression)
- [ ] Two images drop → no modal, 2-cell grid centered on drop
- [ ] Folder of 30 mixed media → modal → Import → 6x5 grid
- [ ] Zip of 10 images → modal → Import → grid
- [ ] Nested zip (zip in zip in folder of images) → modal flattens all
- [ ] 6000-file folder → modal shows hard-cap error, Import disabled. Generate the fixture with:

```bash
mkdir -p /tmp/netrart-bigfolder
# Copy any small PNG repeatedly; adjust source path to a local image you have.
SRC=apps/app/src-tauri/icons/32x32.png
for i in $(seq 1 6000); do cp "$SRC" "/tmp/netrart-bigfolder/img-$i.png"; done
```

Then drag `/tmp/netrart-bigfolder` onto the canvas.
- [ ] Cancel during scan → no orphan uploads, modal closes

- [ ] **Step 2: Tauri desktop verification**

Run: `pnpm tauri:dev`. Repeat the same matrix from above on the desktop build.

- [ ] **Step 3: Typecheck and full test run**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(ingest): address issues found during integration pass"
```

(Skip if no fixes needed.)

---

## Verification summary

After Task 12, the feature is complete. The spec's full scope is covered:

- ✅ HTML5 folder + zip drops (Task 5, 8)
- ✅ Tauri native folder + zip drops (Task 10, 11)
- ✅ Nested zips with depth + size caps (Task 2)
- ✅ Preview modal, always shown for folder/zip (Task 6, 7, 8)
- ✅ Soft/hard item + size caps (Task 1, 5, 11)
- ✅ Grid placement (Task 3, 8)
- ✅ Unit tests for pure logic (Task 1, 2, 3, 5)
- ✅ Manual integration tests (Task 8, 11, 12)
