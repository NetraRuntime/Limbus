import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractZipRecursive } from '../mediaIngest';
import { detectAnnotations } from './detect';

const tinyPng = () =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

describe('detectAnnotations integration — COCO in zip', () => {
  it('detects COCO annotations and pairs images by file_name', async () => {
    const coco = JSON.stringify({
      images: [{ id: 1, file_name: 'a.jpg', width: 10, height: 10 }],
      annotations: [
        { image_id: 1, category_id: 1, bbox: [0, 0, 5, 5] },
        { image_id: 1, category_id: 2, bbox: [5, 5, 10, 10] },
      ],
      categories: [
        { id: 1, name: 'cat' },
        { id: 2, name: 'dog' },
      ],
    });
    const zip = zipSync({
      'images/a.jpg': tinyPng(),
      'annotations/instances.json': strToU8(coco),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('coco');
    expect(plan.totalAnnotations).toBe(2);
    expect(plan.imagesWithAnnotations).toBe(1);
    expect(plan.classes.sort()).toEqual(['cat', 'dog']);
  });
});

describe('detectAnnotations integration — YOLO in zip', () => {
  it('detects YOLO labels with data.yaml class list', async () => {
    const zip = zipSync({
      'images/a.jpg': tinyPng(),
      'labels/a.txt': strToU8('0 0.5 0.5 0.2 0.2\n1 0.3 0.3 0.1 0.1\n'),
      'data.yaml': strToU8('names: [cat, dog]\n'),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('yolo');
    expect(plan.totalAnnotations).toBe(2);
    expect(plan.classes.sort()).toEqual(['cat', 'dog']);
  });
});

describe('detectAnnotations integration — VOC in zip', () => {
  it('detects VOC via per-image XML pairing', async () => {
    const xml = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name><bndbox><xmin>0</xmin><ymin>0</ymin><xmax>5</xmax><ymax>5</ymax></bndbox></object>
    </annotation>`;
    const zip = zipSync({
      'JPEGImages/a.jpg': tinyPng(),
      'Annotations/a.xml': strToU8(xml),
    });
    const budget = { bytesUsed: 0, limit: 1024 * 1024 * 1024 };
    const descs = extractZipRecursive(zip, 'drop', 1, budget);
    const plan = await detectAnnotations(descs);
    expect(plan.format).toBe('voc');
    expect(plan.totalAnnotations).toBe(1);
  });
});
