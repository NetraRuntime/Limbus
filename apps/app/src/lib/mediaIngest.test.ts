import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  classifyByExtension,
  extractZipRecursive,
  SizeCapExceededError,
  DepthCapExceededError,
  ZipMalformedError,
  SOFT_ITEM_CAP,
  HARD_ITEM_CAP,
  MAX_ZIP_DEPTH,
  MAX_UNCOMPRESSED_BYTES,
  SOFT_SIZE_BYTES,
  buildDescriptorFromFile,
  dropContainsFolderOrZip,
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
    expect(classifyByExtension('a.md')).toBe(null);
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

  it('skips non-media, non-annotation entries silently', () => {
    const zip = buildZip({
      'a.png': tinyPng(),
      'readme.md': strToU8('hi'),
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

  it('exactly MAX_ZIP_DEPTH nesting succeeds without throwing', () => {
    // MAX_ZIP_DEPTH wrappings over a leaf zip → deepest recursion enters
    // at depth MAX_ZIP_DEPTH, which does NOT throw.
    let current = buildZip({ 'leaf.png': tinyPng() });
    for (let i = 0; i < MAX_ZIP_DEPTH; i++) {
      current = buildZip({ 'nested.zip': current });
    }
    const out = extractZipRecursive(current, 'root.zip', 0, {
      bytesUsed: 0,
      limit: MAX_UNCOMPRESSED_BYTES,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('leaf.png');
  });

  it('exactly at size cap succeeds; one byte over throws', () => {
    const zip = buildZip({ 'a.png': tinyPng() });
    const entryBytes = tinyPng().byteLength;

    // Construct a limit such that this single entry brings us exactly to it.
    const exactBudget = {
      bytesUsed: 0,
      limit: entryBytes,
    };
    const out = extractZipRecursive(zip, 'root.zip', 0, exactBudget);
    expect(out).toHaveLength(1);

    const overBudget = {
      bytesUsed: 1,
      limit: entryBytes,
    };
    expect(() =>
      extractZipRecursive(zip, 'root.zip', 0, overBudget),
    ).toThrow(SizeCapExceededError);
  });

  it('throws ZipMalformedError on malformed zip bytes', () => {
    const garbage = new Uint8Array([0, 0, 0, 0, 1, 2, 3]);
    expect(() =>
      extractZipRecursive(garbage, 'root.zip', 0, {
        bytesUsed: 0,
        limit: MAX_UNCOMPRESSED_BYTES,
      }),
    ).toThrow(ZipMalformedError);
  });
});

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
    const inner = buildZip({ 'a.png': tinyPng() });
    // fflate returns Uint8Array<ArrayBufferLike>; DOM BlobPart requires the
    // narrower ArrayBufferView<ArrayBuffer>. Cast at the test boundary.
    const f = new File([inner as BlobPart], 'pack.zip', { type: 'application/zip' });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = await buildDescriptorFromFile(f, 'folder/pack.zip', budget);
    expect(descs).toHaveLength(1);
    expect(descs[0]!.relativePath).toBe('folder/pack.zip/a.png');
  });

  it('non-media, non-annotation, non-zip File yields no descriptors', async () => {
    const f = new File(['hi'], 'readme.md', { type: 'text/markdown' });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = await buildDescriptorFromFile(f, 'readme.md', budget);
    expect(descs).toHaveLength(0);
  });
});

describe('dropContainsFolderOrZip', () => {
  it('returns true when a fallback file is a zip', () => {
    const zipFile = new File([], 'pack.zip');
    expect(
      dropContainsFolderOrZip({ entries: [], fallbackFiles: [zipFile] }),
    ).toBe(true);
  });

  it('returns true when an entry is a directory', () => {
    const fakeDir = {
      isDirectory: true,
      isFile: false,
      name: 'photos',
    } as FileSystemEntry;
    expect(
      dropContainsFolderOrZip({ entries: [fakeDir], fallbackFiles: [] }),
    ).toBe(true);
  });

  it('returns false for only-plain-file fallbacks', () => {
    const img = new File([], 'a.png');
    expect(
      dropContainsFolderOrZip({ entries: [], fallbackFiles: [img] }),
    ).toBe(false);
  });
});

describe('classifyByExtension — annotations', () => {
  it('recognizes annotation extensions', () => {
    for (const n of ['a.json', 'a.txt', 'a.xml', 'a.yaml', 'a.yml', 'a.names']) {
      expect(classifyByExtension(n), n).toBe('annotation');
    }
  });
});

describe('extractZipRecursive — annotations', () => {
  it('emits descriptors for annotation files alongside images', () => {
    const zip = buildZip({
      'img/a.jpg': tinyPng(),
      'labels/a.txt': strToU8('0 0.5 0.5 0.2 0.2'),
      'notes.md': strToU8('ignored'),
    });
    const budget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const kinds = descs.map((d) => d.kind).sort();
    expect(kinds).toEqual(['annotation', 'image']);
  });
});
