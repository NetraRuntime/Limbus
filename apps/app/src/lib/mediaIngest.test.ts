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
