# Annotation Format Import for Zip & Folder Uploads

**Date:** 2026-04-24
**Scope:** `apps/app` (Tauri desktop app)
**Status:** Design approved, awaiting implementation plan.

## Goal

Extend the existing zip and folder upload paths in NetraRT to also ingest bounding-box, polygon, and RLE annotations from COCO, YOLO, and Pascal VOC datasets, and materialize them as segmentation masks on the canvas.

Today, `mediaIngest.ts` accepts images and videos only; sidecar annotation files are dropped. After this change, a user can drag a dataset folder or zip from any of those three formats and see images appear on the canvas already tagged and masked.

## Non-goals

- New storage schema. Annotations map onto the existing `segmentations` PocketBase collection.
- Native polygon storage. Polygons and RLE are rasterized to PNG masks at upload time to satisfy the current `SegMask { png_base64, width, height }` shape.
- Round-trip export. This spec covers import only.
- Formats beyond COCO / YOLO / Pascal VOC (e.g., LabelMe, CVAT). The parser layout leaves room for these later.
- Backwards-compatibility shims. Detection is purely additive; archives with no recognizable annotations behave exactly as today.

## User flow

1. User drags a zip or folder onto the canvas (or drops a path from the Tauri file picker).
2. Existing descriptor scan runs, now also keeping `.json` / `.txt` / `.xml` / `.yaml` / `.names` files.
3. A new detection step scans descriptors, pairs images to annotation sources by basename, and produces an `AnnotationPlan`.
4. The existing `ImportPreviewModal` gains an "Annotations" panel showing detected format, image count, annotation count, class list, and any warnings. If more than one format is present, the panel shows a format picker.
5. User confirms. Images upload via the existing `runUploadPlan()`. Once image IDs are known, a new `runAnnotationPlan()` parses + rasterizes + upserts segmentations.
6. Progress is reported through the existing upload progress channel.

## Architecture

Annotation handling lives in a new feature folder:

```
apps/app/src/lib/annotations/
  types.ts              # ParsedAnnotation, ClassMap, AnnotationPlan, RawAnnotation
  detect.ts             # detectAnnotations(descriptors) -> AnnotationPlan (cheap scan)
  coco.ts               # parseCoco(jsonText, classMap) — bbox + polygon + RLE
  yolo.ts               # parseYolo(txtText, classMap, imageSize) — bbox + polygon (v8-seg)
  voc.ts                # parseVoc(xmlText) — bbox only
  classMap.ts           # readClassList(file) — data.yaml / classes.txt / obj.names
  rasterize.ts          # polygonToPng(), rleToPng(), bboxToPng() — base64 PNG
  index.ts              # public API barrel (feature boundary only)
```

Only `index.ts` is imported from outside `lib/annotations/`. Matches the feature-folder rule in `CLAUDE.md`.

### Touched existing files

- `apps/app/src/lib/mediaIngest.ts`
  - Widen `classifyByExtension()` to also surface `'annotation'` kinds for `.json` / `.txt` / `.xml` / `.yaml` / `.names`.
  - Extend `MediaDescriptor` with an optional `annotationKind` hint so detection does not re-walk the tree.
  - The existing image/video-only fast path in the drop handler should still fire for drops that contain no annotation files.
- `apps/app/src/hooks/useImportPreview.ts`
  - After the descriptor scan, call `detectAnnotations(descriptors)` and stash the returned `AnnotationPlan` on the preview state.
- `apps/app/src/components/ImportPreviewModal.tsx`
  - New "Annotations" panel: format, counts, class list, warnings, optional format picker when `format === 'mixed'`.
- `apps/app/src/Canvas.tsx`
  - After `runUploadPlan()` resolves with PB image IDs, call a new `runAnnotationPlan(plan, imageIdByDescriptor)` that parses, rasterizes, and upserts via `upsertSegmentation()`.

No changes to `pb/` migrations or server schema.

## Detection pass

`detectAnnotations(descriptors: MediaDescriptor[]): AnnotationPlan` is synchronous-ish (reads small files), cheap, and side-effect-free. It runs right after the descriptor scan and before the preview modal opens.

Steps:

1. **Class-list files.** Pick up `data.yaml` (parse the `names:` list), `classes.txt` / `obj.names` (newline-separated). YOLO requires one; COCO embeds classes in the JSON; VOC uses class names inline on each object.
2. **Format signal per file.**
   - `.json`: read only if under 64 MB; parse the outer JSON, check for `{ images, annotations, categories }` keys → COCO.
   - `.xml`: peek the first 1 KB for an `<annotation>` root → VOC.
   - `.txt` (excluding class-list files): if the basename matches an image basename → YOLO candidate.
3. **Pairing.**
   - Build `imagesByBasename: Map<string, MediaDescriptor>` (lowercased, extension stripped).
   - COCO: for each JSON, for each `images[].file_name`, look up by basename; fallback to full relative path.
   - YOLO: for each `.txt` sidecar, match basename.
   - VOC: for each `.xml`, match basename.
4. **Ambiguity.** If more than one format has matches, mark `format: 'mixed'` and return per-format counts so the modal can show a picker.

Output shape:

```ts
type AnnotationPlan = {
  format: 'coco' | 'yolo' | 'voc' | 'mixed' | 'none';
  imagesWithAnnotations: number;
  totalAnnotations: number;
  classes: string[];
  unmatchedAnnotations: number; // annotations whose image wasn't in the archive
  warnings: string[];
  // Internal: descriptor → parser + source reference, used later by runAnnotationPlan.
  sources: AnnotationSource[];
};
```

## Parse + rasterize pass

`runAnnotationPlan(plan, imageIdByDescriptor)` runs after `runUploadPlan()` finishes and PB image IDs are known.

1. **Resolve image pixel dimensions.** Required for YOLO (normalized coords) and for sizing the mask canvas.
   - COCO: use `images[].width` / `height` from the JSON.
   - VOC: use the `<size><width>` / `<height>` tags.
   - YOLO: no dimensions in the sidecar, so decode the image via `createImageBitmap(file)` once per image and cache the result. This is done lazily during the parse pass; avoids an upfront O(N) dimension scan for non-YOLO imports.
2. For each `AnnotationSource`, call the matching parser. Each parser yields `ParsedAnnotation { className, bbox?, polygon?, rle?, imageWidth, imageHeight }`. Parsers are pure and independently testable.
3. For each annotation, rasterize to base64 PNG via `rasterize.ts`:
   - `bbox` only → draw a filled rectangle on an image-sized canvas.
   - `polygon` → `ctx.fill()` on the polygon path; multi-polygon uses even-odd winding for holes.
   - `rle` → decode RLE (COCO uncompressed `[counts, size]` and compressed string) into a binary mask, put on canvas, `toDataURL('image/png')`.
4. Group annotations by `(imageId, className)` and build `SegMask[]` per group. `className` is lowercased to match the existing case-insensitive-unique tag rule. Each imported mask gets `score: 1` (imports carry no confidence signal).
5. Upsert each group via the existing `upsertSegmentation(imageId, tag, masks, sourceWidth, sourceHeight)`. One PB record per (image, tag).
6. Progress ticks are emitted per processed image through the same channel as the image upload progress.

### Class → tag mapping

- Direct: `className` → `tag`, lowercased.
- YOLO without a class list: generate `class_0`, `class_1`, …; surface a warning in the modal.
- COCO `supercategory` is ignored in this iteration.

## Error handling

- **Parser errors are per-file and non-fatal.** Malformed JSON/XML/TXT is caught, counted, and listed in modal warnings ("12 annotation files failed to parse"). The rest of the import proceeds.
- **Oversized JSONs (> 64 MB)** skip detection and fall back to "images only" with a warning. Large COCO dumps can be split by the user.
- **Rasterization failures** (e.g., degenerate polygons, RLE length mismatch) are caught per-annotation, counted, logged; the image still gets its remaining masks.
- **Image referenced by annotation but missing from archive** → counted in `unmatchedAnnotations`, shown in modal, skipped.
- **Image with no annotations** → imported as-is (current behavior preserved).
- **No feature flag.** If nothing annotation-shaped is found, the flow is byte-for-byte identical to today.

## Testing

- **Parser unit tests.** Fixture-based, one fixture per format, covering bbox, polygon, and COCO RLE (both compressed and uncompressed). Includes class-list file variants (`data.yaml`, `classes.txt`, `obj.names`). Pure-function parsers make these cheap.
- **Rasterizer unit tests.** Feed known primitives, assert output PNG dimensions and a few pixel samples. Use a canvas shim if the test runner does not supply one natively.
- **Detection integration test.** Build a descriptor list from an on-disk zip fixture, run `detectAnnotations()`, assert the returned `AnnotationPlan` (counts, format, warnings).
- **Manual end-to-end.** Drop three small real datasets (COCO, YOLO, VOC) into a running dev app. Confirm the preview modal shows correct counts, then confirm segmentations appear on canvas after upload. Capture the playbook in a brief `test-plan.md` alongside the parsers.

## Resolved defaults

- **YOLO-seg polygon support:** yes (trivial once we have bbox + class list).
- **COCO compressed RLE:** yes (short JS decoder).
- **Native polygon storage in PB:** no — rasterize to PNG to fit existing `SegMask` shape. Revisit later if exports or polygon editing become requirements.
- **Max annotations per archive:** no new hard cap beyond existing zip caps. Rasterization progress keeps the UI responsive.

## Open questions

None blocking implementation. Follow-up items for future iterations:

- Native polygon storage + editing UI (required for lossless COCO/YOLO-seg round-trip).
- Annotation export (reverse of this spec).
- Additional formats (LabelMe, CVAT, Label Studio JSON).
