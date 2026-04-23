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
