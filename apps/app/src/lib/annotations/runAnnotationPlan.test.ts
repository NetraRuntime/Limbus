import { describe, it, expect, vi } from 'vitest';
import { buildSegMaskGroups, runAnnotationPlan } from './runAnnotationPlan';
import type { ParsedAnnotation } from './types';
import type { RunAnnotationPlanInput, SegGroup } from './runAnnotationPlan';

// Stub canvas-based PNG encoding so runAnnotationPlan tests run in a Node
// environment without a DOM. The rasterize module is only a test concern here;
// unit tests for it live in rasterize.test.ts.
vi.mock('./rasterize', () => ({
  geometryToMaskBytes: vi.fn(() => new Uint8ClampedArray(4)),
  maskBytesToPngBase64: vi.fn(async () => 'STUB_PNG'),
}));

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

  it('calls onEncoded per annotation with monotonically increasing count', async () => {
    const annotations: Array<{ imageId: string; annotation: ParsedAnnotation }> = [
      {
        imageId: 'img1',
        annotation: {
          className: 'cat',
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
    const calls: Array<[number, number]> = [];
    await buildSegMaskGroups(annotations, async () => 'AAA', (d, t) => calls.push([d, t]));
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});

describe('runAnnotationPlan return shape', () => {
  function makeVocSource(
    name: string,
    imageDescriptorPath: string,
    className: string,
  ) {
    return {
      format: 'voc' as const,
      descriptor: {
        relativePath: name,
        load: async () =>
          `<annotation>
            <filename>${imageDescriptorPath}</filename>
            <size><width>10</width><height>10</height><depth>3</depth></size>
            <object>
              <name>${className}</name>
              <bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox>
            </object>
          </annotation>`,
      },
      imageDescriptorPath,
    };
  }

  // Satisfies MediaDescriptor without real File I/O.
  function makeImageDescriptor(relativePath: string) {
    return {
      relativePath,
      name: relativePath,
      size: 0,
      kind: 'image' as const,
      mime: 'image/jpeg',
      source: { type: 'file' as const, file: new File([], relativePath) },
      load: async () => new File([], relativePath),
    };
  }

  // Minimal AnnotationPlan — only `sources` matters for runAnnotationPlan.
  function makePlan(sources: ReturnType<typeof makeVocSource>[]) {
    return {
      format: 'voc' as const,
      perFormat: {},
      classes: [],
      imagesWithAnnotations: 0,
      totalAnnotations: 0,
      unmatchedAnnotations: 0,
      warnings: [],
      sources,
    };
  }

  it('returns distinct counters with correct units', async () => {
    const upsertSpy = vi.fn(async (_group: SegGroup) => {});
    const input: RunAnnotationPlanInput = {
      plan: makePlan([makeVocSource('cat.xml', 'img1.jpg', 'cat')]),
      chosenFormat: 'none',
      descriptors: [makeImageDescriptor('img1.jpg')],
      imageIdByDescriptorPath: new Map([['img1.jpg', 'pb-img-1']]),
      upsert: upsertSpy,
    };

    const result = await runAnnotationPlan(input);

    // Shape
    expect(result).toHaveProperty('annotationsImported');
    expect(result).toHaveProperty('annotationsUnmatched');
    expect(result).toHaveProperty('groupsImported');
    expect(result).toHaveProperty('groupsFailed');
    expect(result).toHaveProperty('errors');

    // Semantics: one annotation, one group, no failures, no unmatched.
    expect(result.annotationsUnmatched).toBe(0);
    expect(result.groupsImported).toBe(1);
    expect(result.groupsFailed).toBe(0);
    expect(result.annotationsImported).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('counts groupsFailed and excludes failed group annotations from annotationsImported', async () => {
    // Two sources, two images, two groups. The second upsert throws.
    let callCount = 0;
    const upsertSpy = vi.fn(async (_group: SegGroup) => {
      callCount++;
      if (callCount === 2) throw new Error('db write failed');
    });

    const input: RunAnnotationPlanInput = {
      plan: makePlan([
        makeVocSource('a.xml', 'imgA.jpg', 'cat'),
        makeVocSource('b.xml', 'imgB.jpg', 'dog'),
      ]),
      chosenFormat: 'none',
      descriptors: [makeImageDescriptor('imgA.jpg'), makeImageDescriptor('imgB.jpg')],
      imageIdByDescriptorPath: new Map([
        ['imgA.jpg', 'pb-img-A'],
        ['imgB.jpg', 'pb-img-B'],
      ]),
      upsert: upsertSpy,
    };

    const result = await runAnnotationPlan(input);

    expect(result.groupsFailed).toBe(1);
    expect(result.groupsImported).toBe(1);
    // Only the first group's annotations count; the failed group's are excluded.
    expect(result.annotationsImported).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
