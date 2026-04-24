import { describe, it, expect } from 'vitest';
import { computeSignature, type SignatureInput } from './signature';

const mk = (tag: string, index: number, png: string): SignatureInput[number] => ({
  tag,
  maskIndex: index,
  png_base64: png,
});

describe('computeSignature', () => {
  it('is stable for identical inputs', () => {
    const a = [mk('cat', 0, 'AAAABBBB'), mk('cat', 1, 'CCCCDDDD')];
    expect(computeSignature(a)).toBe(computeSignature(a));
  });

  it('changes when a mask is added', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [...a, mk('cat', 1, 'CCCCDDDD')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('changes when a mask payload changes', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('cat', 0, 'AAAACCCC')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('changes when a tag is renamed', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('kitty', 0, 'AAAABBBB')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('is case-insensitive on tag', () => {
    const a = [mk('cat', 0, 'AAAABBBB')];
    const b = [mk('CAT', 0, 'AAAABBBB')];
    expect(computeSignature(a)).toBe(computeSignature(b));
  });

  it('is order-sensitive (preserves render order)', () => {
    const a = [mk('cat', 0, 'AAAABBBB'), mk('dog', 0, 'CCCCDDDD')];
    const b = [mk('dog', 0, 'CCCCDDDD'), mk('cat', 0, 'AAAABBBB')];
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });
});
