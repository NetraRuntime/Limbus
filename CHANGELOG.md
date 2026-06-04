# Changelog

All notable changes to NetraRT are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-04

First tracked release of the NetraRT canvas.

### Added
- Infinite-canvas desktop app (Tauri) with the image-annotation workflow.
- SAM3 segmentation via the bundled `sam3.c` native library (Metal/Accelerate
  on macOS).
- Local-first storage backed by an embedded PocketBase sidecar.
- Multi-project canvas and a Home window.
- Drag-and-drop media ingest (images, videos, folders, and zips), annotation
  import, and segmentation-mask persistence.
- macOS code-signed, notarized release pipeline with an auto-updater.

[Unreleased]: https://github.com/rifkybujana/app.netrart.com/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rifkybujana/app.netrart.com/releases/tag/v0.2.0
