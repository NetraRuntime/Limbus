import { describe, it, expect, vi } from 'vitest';
import { buildSegMaskGroups } from './runAnnotationPlan';
import type { ParsedAnnotation } from './types';

describe('buildSegMaskGroups', () => {
  it('groups annotations by (imageId, className) and lowercases className', async () => {
    const annotations: Array<{ imageId: string; annotation: ParsedAnnotation }> = [
      {
        imageId: 'img1',
        annotation: {
          className: 'Cat',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [0, 0, 5, 5],
          geometry: { kind: 'bbox' },
        },
      },
      {
        imageId: 'img1',
        annotation: {
          className: 'cat',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [5, 5, 10, 10],
          geometry: { kind: 'bbox' },
        },
      },
      {
        imageId: 'img1',
        annotation: {
          className: 'dog',
          imageWidth: 10,
          imageHeight: 10,
          bbox: [0, 0, 3, 3],
          geometry: { kind: 'bbox' },
        },
      },
    ];

    const encode = vi.fn(async () => 'AAA');
    const groups = await buildSegMaskGroups(annotations, encode);
    expect(groups).toHaveLength(2);
    const catGroup = groups.find((g) => g.tag === 'cat')!;
    expect(catGroup.imageId).toBe('img1');
    expect(catGroup.masks).toHaveLength(2);
    expect(catGroup.masks[0]!.bbox).toEqual([0, 0, 5, 5]);
    expect(catGroup.masks[0]!.score).toBe(1);
    expect(catGroup.masks[0]!.png_base64).toBe('AAA');
    expect(encode).toHaveBeenCalledTimes(3);
  });
});
