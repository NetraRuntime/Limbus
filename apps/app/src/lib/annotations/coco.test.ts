import { describe, it, expect } from 'vitest';
import { isCocoJson, parseCoco, cocoImageFilenames, type CocoJson } from './coco';

const baseJson: CocoJson = {
  images: [
    { id: 1, file_name: 'a.jpg', width: 100, height: 80 },
    { id: 2, file_name: 'sub/b.png', width: 50, height: 50 },
  ],
  annotations: [
    { image_id: 1, category_id: 1, bbox: [10, 20, 30, 40] },
    {
      image_id: 2,
      category_id: 2,
      bbox: [5, 5, 10, 10],
      segmentation: [[5, 5, 15, 5, 15, 15, 5, 15]],
    },
    {
      image_id: 1,
      category_id: 2,
      bbox: [0, 0, 10, 10],
      segmentation: { counts: [0, 5, 75, 5, 5, 10], size: [80, 100] },
    },
  ],
  categories: [
    { id: 1, name: 'cat' },
    { id: 2, name: 'dog' },
  ],
};

describe('isCocoJson', () => {
  it('detects COCO shape', () => {
    expect(isCocoJson(baseJson)).toBe(true);
    expect(isCocoJson({})).toBe(false);
    expect(isCocoJson({ images: [], annotations: [] })).toBe(false);
  });
});

describe('cocoImageFilenames', () => {
  it('returns file_name values', () => {
    expect(cocoImageFilenames(baseJson)).toEqual(['a.jpg', 'sub/b.png']);
  });
});

describe('parseCoco', () => {
  it('emits bbox-only annotations when segmentation is absent', () => {
    const out = parseCoco(baseJson);
    const bboxOnly = out.filter((p) => p.annotation.geometry.kind === 'bbox');
    expect(bboxOnly).toHaveLength(1);
    expect(bboxOnly[0]!.imageId).toBe(1);
    expect(bboxOnly[0]!.annotation).toMatchObject({
      className: 'cat',
      imageWidth: 100,
      imageHeight: 80,
      bbox: [10, 20, 40, 60],
    });
  });

  it('emits polygon geometry when segmentation is array-of-arrays', () => {
    const out = parseCoco(baseJson);
    const poly = out.find((p) => p.annotation.geometry.kind === 'polygon');
    expect(poly).toBeDefined();
    expect(poly!.annotation.className).toBe('dog');
    const g = poly!.annotation.geometry as { kind: 'polygon'; rings: number[][] };
    expect(g.rings).toEqual([[5, 5, 15, 5, 15, 15, 5, 15]]);
  });

  it('emits rle geometry when segmentation is an RLE object', () => {
    const out = parseCoco(baseJson);
    const rle = out.find((p) => p.annotation.geometry.kind === 'rle');
    expect(rle).toBeDefined();
    const g = rle!.annotation.geometry as { kind: 'rle'; counts: number[]; width: number; height: number };
    expect(g.width).toBe(100);
    expect(g.height).toBe(80);
    expect(g.counts).toEqual([0, 5, 75, 5, 5, 10]);
  });

  it('decodes compressed RLE counts string to numbers that sum to width*height', () => {
    const withCompressed = {
      ...baseJson,
      annotations: [
        { image_id: 1, category_id: 1, bbox: [0, 0, 2, 2], segmentation: { counts: '04', size: [2, 2] } },
      ],
    };
    const out = parseCoco(withCompressed as unknown as Parameters<typeof parseCoco>[0]);
    const g = out[0]!.annotation.geometry as { kind: 'rle'; counts: number[]; width: number; height: number };
    expect(g.kind).toBe('rle');
    const sum = g.counts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(g.width * g.height);
  });

  it('skips annotations whose image_id has no matching image', () => {
    const orphan = {
      ...baseJson,
      annotations: [{ image_id: 999, category_id: 1, bbox: [0, 0, 1, 1] }],
    };
    expect(parseCoco(orphan as unknown as Parameters<typeof parseCoco>[0])).toEqual([]);
  });
});
