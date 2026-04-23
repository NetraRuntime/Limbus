# Folder and Zip Upload Design

**Date:** 2026-04-23
**Status:** Approved, ready for planning
**Scope:** `apps/app` (canvas app, both web debug build and Tauri desktop)

## Summary

Extend canvas ingestion so drag-and-drop accepts folders and `.zip`
archives in addition to individual image/video files. Recurse into
nested folders and nested zips. On Tauri, use native filesystem
traversal via custom Rust commands. When a folder or zip is dropped,
show a preview modal with the full content list, counts, total size,
and soft/hard caps before the upload starts.

No new UI surface on the canvas itself. Trigger is drag-and-drop
only.

## Scope

**In scope**
- HTML5 drag-and-drop of folders (recursive) and `.zip` files in the
  web debug build.
- Tauri native drag-and-drop of folders and `.zip` files (flip
  `dragDropEnabled: true`, use `onDragDropEvent` + Rust commands).
- Nested zips (zip inside zip inside folder inside zip, up to depth 4).
- Preview modal showing descriptors before upload starts, with soft
  warn (500 items / 1 GB) and hard block (5000 items / 4 GB
  uncompressed).
- Grid placement for N items, replacing the current horizontal row
  layout.

**Out of scope**
- `.tar.gz`, `.tar`, `.7z`, `.rar`. Only `.zip`.
- Streaming uploads. Files are read fully into memory before upload,
  matching the existing upload pipeline.
- Per-file progress during zip decompression. Spinner + running
  "Scanning... N items, X MB" text is enough.
- An explicit upload button in the UI. Drag-and-drop only.
- Folder/zip import UI on the public website. `apps/website` is
  unaffected.

## Architecture

### Ingestion flow

```
┌─────────────────────┐    ┌─────────────────────┐
│ Web debug (browser) │    │ Tauri desktop       │
│ HTML5 onDrop        │    │ onDragDropEvent     │
└──────────┬──────────┘    └──────────┬──────────┘
           │                          │
           ▼                          ▼
 scanDataTransfer(dt)       scanTauriPaths(paths)
           │                          │
           ├──────────┬───────────────┤
           │          │
           ▼          ▼
     MediaDescriptor[] (unified)
           │
           ▼
  requires preview? (any folder or zip in drop?)
           │
    ┌──────┴──────┐
    │yes          │no
    ▼             ▼
  Modal       direct upload
    │
    ▼
  user Import
    │
    ▼
  for each descriptor:
    File = await descriptor.load()
    uploadPipeline(File, placement)
```

### MediaDescriptor (common abstraction)

```ts
type DescriptorSource =
  | { type: 'web-entry'; entry: FileSystemFileEntry }
  | { type: 'tauri-path'; absolutePath: string }
  | { type: 'zip-blob'; bytes: Uint8Array };

type MediaDescriptor = {
  relativePath: string;    // 'photos/2024/IMG_0001.jpg'
                           // or 'archive.zip/inner.zip/clip.mp4'
  name: string;            // 'IMG_0001.jpg'
  size: number;            // uncompressed bytes
  kind: 'image' | 'video';
  mime: string;            // inferred from extension; '' if unknown
  source: DescriptorSource;
  load(): Promise<File>;   // deferred until user confirms import
};
```

Descriptors are the contract between ingestion and upload. Everything
downstream (preview dialog, placement, upload pipeline) consumes
descriptors and never inspects `source`. `load()` is cheap for
`web-entry` and `zip-blob`, does one filesystem read for
`tauri-path`.

### New module: `apps/app/src/lib/mediaIngest.ts`

Pure TypeScript, unit-tested with Vitest. Exports:

- `scanDataTransfer(dt: DataTransfer, signal?: AbortSignal): AsyncIterable<ScanEvent>`
  Walks `dt.items` using `webkitGetAsEntry()`. Captures entries
  synchronously before yielding. Recurses into directories via
  `FileSystemDirectoryEntry.createReader()`. Detects zips by
  extension + MIME, reads bytes via `FileSystemFileEntry.file()`,
  hands off to `extractZipRecursive`.
- `scanTauriPaths(paths: string[], signal?: AbortSignal): AsyncIterable<ScanEvent>`
  Calls `scan_paths` Rust command for each top-level path. Detects
  zip extensions in the result, calls `read_file_bytes` for each
  zip, hands off to `extractZipRecursive`.
- `extractZipRecursive(bytes: Uint8Array, pathPrefix: string, depth: number, budget: SizeBudget): MediaDescriptor[]`
  Uses `fflate.unzipSync`. For each entry: if `.zip` extension and
  `depth < MAX_ZIP_DEPTH`, recurse with incremented depth; else if
  image/video, emit a `zip-blob` descriptor. Budget object tracks
  cumulative uncompressed bytes; throws `SizeCapExceededError` when
  `MAX_UNCOMPRESSED_BYTES` is crossed.
- `classifyByExtension(name: string): 'image' | 'video' | 'zip' | null`
  Single source of truth for the extension whitelist. Reused by the
  current `Canvas.handleFilesDrop` classifier.

### ScanEvent stream

The scan functions yield events so the preview modal can update
incrementally:

```ts
type ScanEvent =
  | { type: 'progress'; scanned: number; bytes: number }
  | { type: 'descriptor'; descriptor: MediaDescriptor }
  | { type: 'warning'; code: 'cap-soft'; count: number; bytes: number }
  | { type: 'done' }
  | { type: 'error'; code: 'cap-hard' | 'zip-malformed' | 'aborted'; message: string };
```

Descriptors arrive one at a time so the modal list populates live.
The hard cap check fires mid-scan and aborts as soon as the threshold
is crossed.

### Caps (exported constants)

```ts
export const MAX_ZIP_DEPTH = 4;
export const MAX_UNCOMPRESSED_BYTES = 4 * 1024 ** 3;  // 4 GB
export const SOFT_ITEM_CAP = 500;
export const HARD_ITEM_CAP = 5000;
export const SOFT_SIZE_BYTES = 1 * 1024 ** 3;         // 1 GB
```

### Tauri integration

#### `src-tauri/tauri.conf.json`

Change `"dragDropEnabled": false` → `"dragDropEnabled": true` on the
main window. This stops the webview from seeing HTML5 drop events in
the desktop build and makes Tauri emit drag-drop events instead.

#### `src-tauri/src/lib.rs`

Add two tauri commands:

```rust
#[derive(Serialize)]
struct EntryInfo {
    absolute_path: String,
    relative_path: String,
    size: u64,
    extension: String,   // lowercased, no dot
}

#[tauri::command]
fn scan_paths(paths: Vec<String>) -> Result<Vec<EntryInfo>, String>;

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String>;
```

`scan_paths` walks each input path with `std::fs::read_dir` +
recursion. For each file: lowercase extension, keep only
image/video/zip extensions (reuse the allowlist as a Rust constant
mirroring `classifyByExtension`), emit an `EntryInfo`. Relative path
is the path relative to the nearest dropped-root directory; for a
bare file, relative path == file name.

`read_file_bytes` reads a full file with `std::fs::read`. Size cap
enforced on the JS side via descriptor `size` before calling.

No plugin-fs, no extra scope config — the commands themselves are the
permission surface. They are registered in the invoke handler.

#### Frontend Tauri subscription

New helper: `apps/app/src/lib/tauriDragDrop.ts`
```ts
export function subscribeTauriDrops(
  handler: (paths: string[], position: { x: number; y: number }) => void,
): () => void;
```

Uses `getCurrentWebview().onDragDropEvent`. Filters on
`event.payload.type === 'drop'`. Resolves no-op unsubscribe when not
running in Tauri.

Called from `Canvas.tsx` in a `useEffect`. Tauri's `onDragDropEvent`
payload `position` is in physical pixels; divide by
`window.devicePixelRatio` to get CSS pixels, then convert to world
coords using the current view (same math as HTML5 path — extract
`clientToWorld` into a shared helper, e.g. `lib/coords.ts`, so both
drop paths share it).

### Preview modal

New component: `apps/app/src/components/ImportPreviewModal.tsx`.
Reuses the backdrop, focus trap, and escape-handling pattern from
`SettingsModal.tsx`.

Props:
```ts
type Props = {
  open: boolean;
  state: {
    phase: 'scanning' | 'ready' | 'error';
    descriptors: MediaDescriptor[];
    bytes: number;
    imageCount: number;
    videoCount: number;
    warning?: { code: 'cap-soft'; message: string };
    error?: { code: 'cap-hard' | 'zip-malformed'; message: string };
  };
  onCancel: () => void;
  onImport: () => void;
};
```

Layout:
- Header: `Import <N> items from <source>` (source = zip filename,
  folder name, or `<N> sources`).
- Summary row: `{imageCount} images · {videoCount} videos · {humanSize(bytes)}`.
- Warning banner when `state.warning`: yellow/amber, icon + text.
- Error banner when `state.error`: red, icon + text, Import disabled.
- Scrollable list, virtualized manually with absolute positioning
  (skip `react-virtual` dep for now; rows are uniform height and
  only ~5000 max, a simple windowing over a fixed-height list is
  enough).
- Footer: `Cancel` (ghost) and `Import` (primary). Import disabled
  while `phase === 'scanning'` or `phase === 'error'`.

Keyboard:
- Esc → onCancel (also aborts any in-flight scan).
- Enter → onImport when not disabled.
- Tab focus trap matching `SettingsModal`.

The modal owns nothing; it's a controlled presenter. Scan state
lives in `Canvas.tsx` via a new `useImportPreview()` hook in
`apps/app/src/hooks/useImportPreview.ts` that manages the scan
lifecycle, `AbortController`, and descriptor accumulator.

### Upload wiring

`Canvas.handleFilesDrop` is renamed to `handleDescriptorsImport` and
takes `MediaDescriptor[]` + drop point. It:
1. Calls `descriptor.load()` on each (concurrency 4) to get File.
2. Runs existing `loadImage`/`loadVideo` for dimensions.
3. Applies `normalizeUploadSize` and **grid placement** instead of
   the current row layout.
4. Builds `UploadPlan[]`, calls `runUploadPlan` as today.

Grid placement:
- `cols = Math.ceil(Math.sqrt(N))`, `rows = Math.ceil(N / cols)`.
- Cell width = `max(width) + GAP`, cell height = `max(height) + GAP`,
  GAP = 32 (existing constant).
- Cluster anchored so its geometric center sits on the drop point.
- For N == 1, collapses to the existing centered placement (cols = 1,
  rows = 1).

The drop handler in `InfiniteCanvas.tsx` stays structurally the same
but now calls a thin wrapper that runs `scanDataTransfer` and either
opens the preview or calls `handleDescriptorsImport` directly based
on whether the drop contains a folder or zip.

Detection of "contains folder or zip" is synchronous from
`dt.items` via `webkitGetAsEntry().isDirectory` and the filename
extension. No preview for plain-file-only drops.

## File-by-file change list

### New files
- `apps/app/src/lib/mediaIngest.ts` — scan + extract + types.
- `apps/app/src/lib/mediaIngest.test.ts` — unit tests (zip
  extraction, nested zip recursion, depth cap, size cap, descriptor
  shape).
- `apps/app/src/lib/tauriDragDrop.ts` — Tauri drop subscription.
- `apps/app/src/hooks/useImportPreview.ts` — scan lifecycle hook.
- `apps/app/src/components/ImportPreviewModal.tsx` — preview dialog.

### Modified files
- `apps/app/src/Canvas.tsx` — replace row placement with grid; route
  drops through `useImportPreview`; rename `handleFilesDrop` →
  `handleDescriptorsImport`; add Tauri drop subscription effect.
- `apps/app/src/InfiniteCanvas.tsx` — replace
  `Array.from(e.dataTransfer.files)` with the scan-first flow;
  expose a shared client-to-world helper (or keep `onFilesDrop`
  renamed to `onDataTransferDrop`).
- `apps/app/src/App.css` — styles for preview modal, reusing
  settings modal tokens.
- `apps/app/package.json` — add `fflate` dependency.
- `apps/app/src-tauri/Cargo.toml` — no new deps (stdlib only).
- `apps/app/src-tauri/src/lib.rs` — add `scan_paths`,
  `read_file_bytes` commands, register in the invoke handler.
- `apps/app/src-tauri/tauri.conf.json` — `dragDropEnabled: true`.

## Testing

### Unit (Vitest)
- `extractZipRecursive` with flat zip, nested zip (1-4 levels),
  zip containing non-media, zip containing corrupt entry.
- Depth cap throws at depth 5.
- Size cap throws when cumulative exceeds `MAX_UNCOMPRESSED_BYTES`.
- `classifyByExtension` exhaustive extension coverage.
- Grid placement math: N = 1 matches current single-drop placement;
  N = 4 makes a 2x2; N = 10 makes a 4x3; cluster center equals drop
  point within 0.5 world units.

### Integration (manual, documented in PR)
- Drop a single image → no modal, direct upload (regression check).
- Drop two individual images → no modal, direct upload as a 2-cell
  grid.
- Drop a folder with 30 mixed images/videos → modal appears, scan
  completes, import creates a 6x5 grid.
- Drop a zip with 10 images → modal appears, import works.
- Drop a zip containing a zip containing a folder of images →
  modal flattens all to one list, import works.
- Drop a 6000-file folder → modal shows hard-cap error, Import
  disabled, Cancel works.
- Cancel a scan mid-flight → abort is honored, no orphan uploads.
- Tauri desktop: drop a folder from Finder/Explorer → Rust `scan_paths`
  is invoked, modal appears, import works.
- Tauri desktop: drop a zip → bytes are read via `read_file_bytes`
  before extraction.
- Web debug build: HTML5 drop path still works with same UX.

## Risks and mitigations

- **Zip bomb / runaway memory**: Mitigated by `MAX_UNCOMPRESSED_BYTES`
  and `MAX_ZIP_DEPTH`, both enforced during extraction.
- **Webview memory from holding many decompressed zip blobs**:
  `MediaDescriptor.source.bytes` keeps decompressed bytes in memory
  until upload. For 4 GB budget, this is accepted for v1. Upload is
  sequential in batches of 4, so GC can reclaim after each upload if
  we null out the reference. Implementation note: clear
  `descriptor.source.bytes` after `load()` resolves once.
- **Tauri drag-drop mode flip breaks web debug**: False — the flag
  only takes effect in the Tauri build. Web debug is unaffected.
- **`onDragDropEvent` position encoding**: Tauri reports physical
  pixels; the webview uses CSS pixels. Handled explicitly in
  `subscribeTauriDrops` (divide by DPR before converting to world
  coords).
- **Folder drops in Safari/older WebKit**: `webkitGetAsEntry()` has
  been stable since 2016. Acceptable.

## Explicit non-decisions (defaulted)

- Preview modal is always shown for folder/zip even if the content
  count is 1. (User said "always show when upload a folder or zip.")
- Plain multi-file drops skip the preview (user confirmed).
- Descriptors' `name` collisions are not deduped; server-side
  PocketBase record ids keep them unique anyway.
- Image/video extension list mirrors the current classifier in
  `Canvas.handleFilesDrop`.
