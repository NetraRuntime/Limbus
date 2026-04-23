import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  classifyByExtension,
  extractZipRecursive,
  SizeCapExceededError,
  DepthCapExceededError,
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
