import { describe, it, expect } from 'vitest';
import { parseYolo } from './yolo';

describe('parseYolo', () => {
  const classMap = { names: ['cat', 'dog', 'tree'] };
  const imageSize = { width: 100, height: 80 };

  it('parses normalized bbox rows to pixel-space bbox annotations', () => {
    const text = '0 0.5 0.5 0.2 0.25\n1 0.1 0.1 0.2 0.2\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      className: 'cat',
      imageWidth: 100,
      imageHeight: 80,
      bbox: [40, 30, 60, 50],
      geometry: { kind: 'bbox' },
    });
    expect(out[1]!.className).toBe('dog');
  });

  it('parses polygon rows (>5 floats, even count after class id)', () => {
    const text = '2 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out).toHaveLength(1);
    expect(out[0]!.geometry).toEqual({
      kind: 'polygon',
      rings: [[10, 8, 30, 8, 30, 24, 10, 24]],
    });
    expect(out[0]!.bbox).toEqual([10, 8, 30, 24]);
  });

  it('falls back to class_N when class index is out of range', () => {
    const text = '9 0.5 0.5 0.2 0.2\n';
    const out = parseYolo(text, classMap, imageSize);
    expect(out[0]!.className).toBe('class_9');
  });

  it('skips blank lines and comments', () => {
    const text = '\n# header\n0 0.5 0.5 0.2 0.2\n';
    expect(parseYolo(text, classMap, imageSize)).toHaveLength(1);
  });

  it('skips malformed rows (odd number of polygon coords)', () => {
    const text = '0 0.1 0.1 0.2 0.2 0.3\n';
    expect(parseYolo(text, classMap, imageSize)).toEqual([]);
  });
});
