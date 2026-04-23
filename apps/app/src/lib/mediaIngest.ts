// apps/app/src/lib/mediaIngest.ts

import { invoke } from '@tauri-apps/api/core';
import { unzipSync } from 'fflate';

export const SOFT_ITEM_CAP = 500;
export const HARD_ITEM_CAP = 5000;
export const SOFT_SIZE_BYTES = 1 * 1024 ** 3;
export const MAX_UNCOMPRESSED_BYTES = 4 * 1024 ** 3;
export const MAX_ZIP_DEPTH = 4;

export type MediaKind = 'image' | 'video';

export type DescriptorSource =
  | { type: 'file'; file: File }
  | { type: 'tauri-path'; absolutePath: string }
  | { type: 'zip-blob'; bytes: Uint8Array };

export type MediaDescriptor = {
  relativePath: string;
  name: string;
  size: number;
  kind: MediaKind;
  mime: string;
  source: DescriptorSource;
  load(): Promise<File>;
};

export type ScanEvent =
  | { type: 'progress'; scanned: number; bytes: number }
  | { type: 'descriptor'; descriptor: MediaDescriptor }
  | { type: 'warning'; code: 'cap-soft'; count: number; bytes: number }
  | { type: 'done' }
  | {
      type: 'error';
      code: 'cap-hard' | 'cap-depth' | 'zip-malformed' | 'aborted' | 'scan-failed';
      message: string;
    };

export type ScanInput = {
  entries: Array<FileSystemEntry | null>;
  fallbackFiles: File[];
};

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi', '3gp',
]);

export function classifyByExtension(name: string): MediaKind | 'zip' | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === 'zip') return 'zip';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

export function mimeFromExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    m4v: 'video/x-m4v', mkv: 'video/x-matroska', ogv: 'video/ogg',
    avi: 'video/x-msvideo', '3gp': 'video/3gpp',
  };
  return map[ext] ?? '';
}

export class SizeCapExceededError extends Error {
  constructor(public bytesUsed: number, public limit: number) {
    super(`uncompressed size cap exceeded: ${bytesUsed} > ${limit}`);
    this.name = 'SizeCapExceededError';
  }
}

export class DepthCapExceededError extends Error {
  constructor(public depth: number) {
    super(`zip depth cap exceeded (depth ${depth} > ${MAX_ZIP_DEPTH})`);
    this.name = 'DepthCapExceededError';
  }
}

export class ZipMalformedError extends Error {
  constructor(public override cause: unknown) {
    super(`zip archive is malformed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'ZipMalformedError';
  }
}

export type SizeBudget = { bytesUsed: number; limit: number };

export function extractZipRecursive(
  zipBytes: Uint8Array,
  pathPrefix: string,
  depth: number,
  budget: SizeBudget,
): MediaDescriptor[] {
  if (depth > MAX_ZIP_DEPTH) throw new DepthCapExceededError(depth);

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (err) {
    throw new ZipMalformedError(err);
  }
  const out: MediaDescriptor[] = [];

  for (const [name, bytes] of Object.entries(entries)) {
    // Directory entries appear as empty zero-length entries ending with '/'.
    if (name.endsWith('/')) continue;

    budget.bytesUsed += bytes.byteLength;
    if (budget.bytesUsed > budget.limit) {
      throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
    }

    const kind = classifyByExtension(name);
    const relativePath = `${pathPrefix}/${name}`;

    if (kind === 'zip') {
      out.push(...extractZipRecursive(bytes, relativePath, depth + 1, budget));
      continue;
    }
    if (kind !== 'image' && kind !== 'video') continue;

    const leaf = name.split('/').pop() ?? name;
    const mime = mimeFromExtension(leaf);
    const descriptor: MediaDescriptor = {
      relativePath,
      name: leaf,
      size: bytes.byteLength,
      kind,
      mime,
      source: { type: 'zip-blob', bytes },
      // fflate's `Unzipped` types entries as `Uint8Array<ArrayBufferLike>`,
      // which DOM's BlobPart (ArrayBufferView<ArrayBuffer>) does not accept
      // without a boundary narrowing in TS 5.9+. The underlying value is
      // always a plain ArrayBuffer at runtime.
      load: async () =>
        new File([bytes as BlobPart], leaf, mime ? { type: mime } : undefined),
    };
    out.push(descriptor);
  }

  return out;
}

export async function buildDescriptorFromFile(
  file: File,
  relativePath: string,
  budget: SizeBudget,
): Promise<MediaDescriptor[]> {
  const kind = classifyByExtension(file.name);
  if (kind === 'zip') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    budget.bytesUsed += bytes.byteLength;
    if (budget.bytesUsed > budget.limit) {
      throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
    }
    return extractZipRecursive(bytes, relativePath, 1, budget);
  }
  if (kind !== 'image' && kind !== 'video') return [];

  budget.bytesUsed += file.size;
  if (budget.bytesUsed > budget.limit) {
    throw new SizeCapExceededError(budget.bytesUsed, budget.limit);
  }

  const mime = file.type || mimeFromExtension(file.name);
  const descriptor: MediaDescriptor = {
    relativePath,
    name: file.name,
    size: file.size,
    kind,
    mime,
    source: { type: 'file', file },
    load: async () => file,
  };
  return [descriptor];
}

// captureDataTransfer produces a ScanInput synchronously from
// DataTransfer.items before the event's DataTransfer handle becomes
// unusable. webkitGetAsEntry must be called synchronously for the same
// reason.
export function captureDataTransfer(dt: DataTransfer): ScanInput {
  const entries: Array<FileSystemEntry | null> = [];
  const fallbackFiles: File[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const it = dt.items[i];
    if (!it || it.kind !== 'file') continue;
    const entry = typeof it.webkitGetAsEntry === 'function'
      ? it.webkitGetAsEntry()
      : null;
    if (entry) {
      entries.push(entry);
    } else {
      const f = it.getAsFile();
      if (f) fallbackFiles.push(f);
    }
  }
  return { entries, fallbackFiles };
}

export function dropContainsFolderOrZip(input: ScanInput): boolean {
  for (const e of input.entries) {
    if (!e) continue;
    if (e.isDirectory) return true;
    if (classifyByExtension(e.name) === 'zip') return true;
  }
  for (const f of input.fallbackFiles) {
    if (classifyByExtension(f.name) === 'zip') return true;
  }
  return false;
}

async function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const out: FileSystemEntry[] = [];
  // FileSystemDirectoryReader.readEntries can return a bounded batch; must
  // call repeatedly until it yields an empty array.
  for (;;) {
    const batch: FileSystemEntry[] = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

const entryToFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  budget: SizeBudget,
  signal: AbortSignal,
  emit: (d: MediaDescriptor) => void,
): Promise<void> {
  if (signal.aborted) return;
  const nextPath = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      if (signal.aborted) return;
      await walkEntry(child, nextPath, budget, signal, emit);
    }
    return;
  }
  if (!entry.isFile) return;
  const file = await entryToFile(entry as FileSystemFileEntry);
  const descs = await buildDescriptorFromFile(file, nextPath, budget);
  for (const d of descs) emit(d);
}

export async function* scanDataTransfer(
  captured: ScanInput,
  signal: AbortSignal,
): AsyncGenerator<ScanEvent> {
  const budget: SizeBudget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
  const queue: MediaDescriptor[] = [];
  let scanned = 0;
  let bytes = 0;
  let softWarned = false;

  const emit = (d: MediaDescriptor) => {
    queue.push(d);
    scanned++;
    bytes += d.size;
  };

  try {
    for (const f of captured.fallbackFiles) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const descs = await buildDescriptorFromFile(f, f.name, budget);
      for (const d of descs) emit(d);
    }
    for (const entry of captured.entries) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (!entry) continue;
      await walkEntry(entry, '', budget, signal, emit);
    }

    // Drain the queue as ScanEvents. The modal populates incrementally
    // during the drain; for folders with thousands of files, HARD_ITEM_CAP
    // and SOFT_ITEM_CAP trip here.
    for (const d of queue) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      yield { type: 'descriptor', descriptor: d };
      if (scanned > HARD_ITEM_CAP) {
        yield {
          type: 'error',
          code: 'cap-hard',
          message: `Too many files (${scanned}). Please split into smaller batches.`,
        };
        return;
      }
      if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
        softWarned = true;
        yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
      }
      yield { type: 'progress', scanned, bytes };
    }
    yield { type: 'done' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
      return;
    }
    if (err instanceof SizeCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-hard',
        message: `Archive exceeds the ${(budget.limit / 1024 ** 3).toFixed(0)} GB uncompressed limit.`,
      };
      return;
    }
    if (err instanceof DepthCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-depth',
        message: `Zip nesting exceeds ${MAX_ZIP_DEPTH} levels.`,
      };
      return;
    }
    if (err instanceof ZipMalformedError) {
      yield {
        type: 'error',
        code: 'zip-malformed',
        message: `Archive is malformed and could not be opened.`,
      };
      return;
    }
    yield {
      type: 'error',
      code: 'scan-failed',
      message: (err as Error).message || 'scan failed',
    };
  }
}

type TauriEntryInfo = {
  absolutePath: string;
  relativePath: string;
  size: number;
  extension: string;
};

function descriptorFromTauriEntry(
  entry: TauriEntryInfo,
): MediaDescriptor | null {
  const kind = classifyByExtension(entry.relativePath);
  if (kind !== 'image' && kind !== 'video') return null;
  const leaf = entry.relativePath.split('/').pop() ?? entry.relativePath;
  const mime = mimeFromExtension(leaf);
  return {
    relativePath: entry.relativePath,
    name: leaf,
    size: entry.size,
    kind,
    mime,
    source: { type: 'tauri-path', absolutePath: entry.absolutePath },
    load: async () => {
      const bytes = (await invoke<number[] | Uint8Array>('read_file_bytes', {
        path: entry.absolutePath,
      })) as unknown as ArrayLike<number>;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return new File([u8 as BlobPart], leaf, mime ? { type: mime } : undefined);
    },
  };
}

export async function* scanTauriPaths(
  paths: string[],
  signal: AbortSignal,
): AsyncGenerator<ScanEvent> {
  const budget: SizeBudget = { bytesUsed: 0, limit: MAX_UNCOMPRESSED_BYTES };
  let scanned = 0;
  let bytes = 0;
  let softWarned = false;

  try {
    const entries = (await invoke<TauriEntryInfo[]>('scan_paths', {
      paths,
    })) as TauriEntryInfo[];
    if (signal.aborted) {
      yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
      return;
    }

    for (const entry of entries) {
      if (signal.aborted) {
        yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
        return;
      }

      const kind = classifyByExtension(entry.relativePath);
      if (kind === 'zip') {
        const rawBytes = (await invoke<number[] | Uint8Array>('read_file_bytes', {
          path: entry.absolutePath,
        })) as unknown as ArrayLike<number>;
        const u8 =
          rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
        // Note: we do NOT add u8.byteLength to budget.bytesUsed here —
        // extractZipRecursive accounts for each uncompressed entry's size
        // against the same budget. Adding the compressed bytes too would
        // double-count and trip the cap too eagerly on legitimate archives.
        const inner = extractZipRecursive(u8, entry.relativePath, 1, budget);
        for (const d of inner) {
          scanned++;
          bytes += d.size;
          yield { type: 'descriptor', descriptor: d };
          if (scanned > HARD_ITEM_CAP) {
            yield {
              type: 'error',
              code: 'cap-hard',
              message: `Too many files (${scanned}).`,
            };
            return;
          }
          if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
            softWarned = true;
            yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
          }
        }
        continue;
      }

      const d = descriptorFromTauriEntry(entry);
      if (!d) continue;
      scanned++;
      bytes += d.size;
      yield { type: 'descriptor', descriptor: d };
      if (scanned > HARD_ITEM_CAP) {
        yield {
          type: 'error',
          code: 'cap-hard',
          message: `Too many files (${scanned}).`,
        };
        return;
      }
      if (!softWarned && (scanned >= SOFT_ITEM_CAP || bytes >= SOFT_SIZE_BYTES)) {
        softWarned = true;
        yield { type: 'warning', code: 'cap-soft', count: scanned, bytes };
      }
    }
    yield { type: 'done' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'error', code: 'aborted', message: 'scan cancelled' };
      return;
    }
    if (err instanceof DepthCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-depth',
        message: `Zip nesting exceeds ${MAX_ZIP_DEPTH} levels.`,
      };
      return;
    }
    if (err instanceof SizeCapExceededError) {
      yield {
        type: 'error',
        code: 'cap-hard',
        message: `Archive exceeds the ${(budget.limit / 1024 ** 3).toFixed(0)} GB uncompressed limit.`,
      };
      return;
    }
    if (err instanceof ZipMalformedError) {
      yield {
        type: 'error',
        code: 'zip-malformed',
        message: `Archive is malformed and could not be opened.`,
      };
      return;
    }
    yield {
      type: 'error',
      code: 'scan-failed',
      message: (err as Error).message || 'scan failed',
    };
  }
}
