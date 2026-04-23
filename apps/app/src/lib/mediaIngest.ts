// apps/app/src/lib/mediaIngest.ts

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
      code: 'cap-hard' | 'zip-malformed' | 'aborted' | 'scan-failed';
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

export type SizeBudget = { bytesUsed: number; limit: number };

export function extractZipRecursive(
  zipBytes: Uint8Array,
  pathPrefix: string,
  depth: number,
  budget: SizeBudget,
): MediaDescriptor[] {
  if (depth > MAX_ZIP_DEPTH) throw new DepthCapExceededError(depth);

  const entries = unzipSync(zipBytes);
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
    const capturedBytes = bytes;
    const descriptor: MediaDescriptor = {
      relativePath,
      name: leaf,
      size: bytes.byteLength,
      kind,
      mime,
      source: { type: 'zip-blob', bytes: capturedBytes },
      load: async () =>
        new File(
          [capturedBytes as BlobPart],
          leaf,
          mime ? { type: mime } : undefined,
        ),
    };
    out.push(descriptor);
  }

  return out;
}
