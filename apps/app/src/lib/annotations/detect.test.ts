import { describe, it, expect } from 'vitest';
import type { MediaDescriptor } from '../mediaIngest';
import { detectAnnotations } from './detect';

function mkDescriptor(
  relativePath: string,
  kind: MediaDescriptor['kind'],
  textOrBytes: string | Uint8Array,
): MediaDescriptor {
  const bytes =
    typeof textOrBytes === 'string'
      ? new TextEncoder().encode(textOrBytes)
      : textOrBytes;
  return {
    relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    size: bytes.byteLength,
    kind,
    mime: '',
    source: { type: 'zip-blob', bytes },
    load: async () => new File([bytes as BlobPart], relativePath),
  };
}

describe('detectAnnotations', () => {
  it('returns none when no annotation files are present', async () => {
    const descs = [mkDescriptor('a.jpg', 'image', new Uint8Array([0]))];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('none');
    expect(plan.totalAnnotations).toBe(0);
  });

  it('detects VOC from basename pairing', async () => {
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('a.xml', 'annotation', xml),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('voc');
    expect(plan.imagesWithAnnotations).toBe(1);
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('detects COCO via json keys and pairs by file_name', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('annotations.json', 'annotation', coco),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('detects YOLO when classes.txt and basename-paired .txt exist', async () => {
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('classes.txt', 'annotation', 'cat\ndog'),
      mkDescriptor('a.txt', 'annotation', '0 0.5 0.5 0.2 0.2'),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('yolo');
    expect(plan.totalAnnotations).toBe(1);
    expect(plan.classes).toEqual(['cat']);
  });

  it('flags mixed when multiple formats have matches', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>dog</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const descs = [
      mkDescriptor('a.jpg', 'image', new Uint8Array([0])),
      mkDescriptor('annotations.json', 'annotation', coco),
      mkDescriptor('a.xml', 'annotation', xml),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('mixed');
    expect(plan.perFormat.coco?.totalAnnotations).toBe(1);
    expect(plan.perFormat.voc?.totalAnnotations).toBe(1);
  });

  it('counts unmatched annotations when images are missing', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'missing.jpg', width: 10, height: 10 }],
      annotations: [{ image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] }],
      categories: [{ id: 1, name: 'cat' }],
    });
    const descs = [
      mkDescriptor('annotations.json', 'annotation', coco),
    ];
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.imagesWithAnnotations).toBe(0);
    expect(plan.unmatchedAnnotations).toBe(1);
  });
});
