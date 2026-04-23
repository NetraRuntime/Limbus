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
