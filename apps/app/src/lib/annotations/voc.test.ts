import { describe, it, expect } from 'vitest';
import { parseVoc, isVocXml } from './voc';

const sample = `<?xml version="1.0"?>
<annotation>
  <size><width>640</width><height>480</height><depth>3</depth></size>
  <object>
    <name>cat</name>
    <bndbox><xmin>10</xmin><ymin>20</ymin><xmax>110</xmax><ymax>220</ymax></bndbox>
  </object>
  <object>
    <name>Dog</name>
    <bndbox><xmin>200</xmin><ymin>50</ymin><xmax>400</xmax><ymax>300</ymax></bndbox>
  </object>
</annotation>`;

describe('isVocXml', () => {
  it('detects VOC by root tag in the first 1KB', () => {
    expect(isVocXml(sample)).toBe(true);
    expect(isVocXml('<?xml version="1.0"?><root/>')).toBe(false);
  });
});

describe('parseVoc', () => {
  it('returns bbox ParsedAnnotations with class name and image size', () => {
    const out = parseVoc(sample);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      className: 'cat',
      imageWidth: 640,
      imageHeight: 480,
      bbox: [10, 20, 110, 220],
      geometry: { kind: 'bbox' },
    });
    expect(out[1]!.className).toBe('Dog');
    expect(out[1]!.bbox).toEqual([200, 50, 400, 300]);
  });

  it('throws on missing size element', () => {
    expect(() => parseVoc('<annotation><object><name>x</name></object></annotation>'))
      .toThrow(/size/);
  });

  it('skips objects without bndbox', () => {
    const bad = `<annotation>
      <size><width>10</width><height>10</height></size>
      <object><name>cat</name></object>
    </annotation>`;
    expect(parseVoc(bad)).toEqual([]);
  });
});
