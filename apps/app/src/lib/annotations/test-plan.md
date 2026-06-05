# Annotation Import — Manual Test Plan

## Setup
- Run `pnpm --filter @netra-limbus/app tauri:dev`.
- Start PocketBase: `pnpm --filter @netra-limbus/app stage:pb` then run the binary per README.

## Fixtures
Prepare three small datasets (3–5 images each):
- **COCO**: folder with `images/*.jpg` + `annotations/instances.json`. Include at least one bbox-only, one polygon, and one RLE annotation.
- **YOLO**: folder with `images/*.jpg`, `labels/*.txt`, and `data.yaml`. Include one bbox-only row and one polygon row.
- **VOC**: folder with `JPEGImages/*.jpg` + `Annotations/*.xml`.

## Cases

### COCO zip
1. Zip the COCO folder, drag onto the canvas.
2. Confirm preview modal shows: "Detected COCO annotations", correct image/annotation/class counts.
3. Confirm "Import" proceeds. Wait for upload to finish.
4. Confirm tags appear on the imported images and masks match the annotation shapes (rectangle for bbox, roughly polygon shape for polygon, RLE shape for RLE).

### YOLO folder
1. Drag the YOLO folder (not zipped) onto the canvas.
2. Confirm preview modal shows "Detected YOLO annotations" with the right class count.
3. Import. Verify tags + bbox/polygon masks.

### VOC zip
1. Zip the VOC folder, drag onto the canvas.
2. Confirm "Detected VOC annotations" with the right counts.
3. Import. Verify bbox masks on each image.

### Mixed zip
1. Zip one with both VOC XML and YOLO txts for the same images.
2. Confirm the preview modal shows the mixed selector; "Import" is disabled until a format is chosen.
3. Pick VOC, import. Verify only VOC annotations materialize.

### No-annotation fallback
1. Zip a plain folder of images (no sidecar files).
2. Confirm no annotation panel appears.
3. Import flow matches current behavior.
