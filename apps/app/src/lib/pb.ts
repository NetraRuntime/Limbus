import PocketBase from 'pocketbase';
import { z } from 'zod';
import { findSegByTag, segIdsToPrune } from './segmentations';

const EnvSchema = z.object({
  VITE_PB_URL: z.string().optional(),
});
const env = EnvSchema.parse(import.meta.env);

const rawUrl = env.VITE_PB_URL ?? '';
const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
export const PB_URL = (rawUrl || (isTauri ? 'http://127.0.0.1:8090' : '')).replace(/\/+$/, '');

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

pb.autoCancellation(false);

// Bookkeeping fields (`collectionName`, `created`, `updated`) are excluded
// from the schema — validating them on every row in bulk hydration burns
// ~200–500 ms at 10k without the app ever reading them. `collectionId` is
// kept because `fileUrl` uses it.
const PlacementRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  file: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  deleted_at: z.string().nullable().optional(),
});

export type ImageRecord = z.infer<typeof PlacementRecordSchema>;
export type VideoRecord = z.infer<typeof PlacementRecordSchema>;
export type MediaKind = 'image' | 'video';

const SegMaskSchema = z.object({
  png_base64: z.string(),
  // Optional so rows persisted before the edge-outline feature still
  // parse; frontend falls back to fill-only when absent.
  edge_png_base64: z.string().optional(),
  width: z.number(),
  height: z.number(),
  score: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const SegmentationRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  image: z.string(),
  tag: z.string(),
  masks: z.array(SegMaskSchema),
  source_width: z.number(),
  source_height: z.number(),
});

export type SegMask = z.infer<typeof SegMaskSchema>;
export type SegmentationRecord = z.infer<typeof SegmentationRecordSchema>;

const fileUrl = (record: { collectionId: string; id: string; file: string }): string =>
  `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(record.file)}`;

export const imageFileUrl = (r: ImageRecord): string => fileUrl(r);
export const videoFileUrl = (r: VideoRecord): string => fileUrl(r);

const parseList = <T>(schema: z.ZodType<T>, raw: unknown): T[] => {
  const arr = z.array(schema).safeParse(raw);
  if (!arr.success) {
    console.warn('[pb] discarding malformed records', arr.error.issues);
    if (Array.isArray(raw)) {
      const out: T[] = [];
      for (const item of raw) {
        const one = schema.safeParse(item);
        if (one.success) out.push(one.data);
      }
      return out;
    }
    return [];
  }
  return arr.data;
};

// PB stores an unset date as an empty string on pre-existing rows and as SQL
// NULL after restoreX clears the field. The filter has to match both.
const ACTIVE_FILTER = 'deleted_at = null || deleted_at = ""';

export const listImages = async (): Promise<ImageRecord[]> => {
  const raw = await pb
    .collection('images')
    .getFullList({ sort: 'created', filter: ACTIVE_FILTER });
  return parseList(PlacementRecordSchema, raw);
};

export const listVideos = async (): Promise<VideoRecord[]> => {
  const raw = await pb
    .collection('videos')
    .getFullList({ sort: 'created', filter: ACTIVE_FILTER });
  return parseList(PlacementRecordSchema, raw);
};

export const listSegmentations = async (): Promise<SegmentationRecord[]> => {
  const raw = await pb.collection('segmentations').getFullList({ sort: 'created' });
  return parseList(SegmentationRecordSchema, raw);
};

export const upsertSegmentation = async (input: {
  image: string;
  tag: string;
  masks: SegMask[];
  source_width: number;
  source_height: number;
}): Promise<SegmentationRecord> => {
  // Fetch this image's rows, find any existing tag match case-insensitively.
  // Row counts per image are small (one per tag), so getFullList is cheap.
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${input.image}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, input.tag);
  const payload = {
    image: input.image,
    tag: input.tag,
    masks: input.masks,
    source_width: input.source_width,
    source_height: input.source_height,
  };
  const record = match
    ? await pb.collection('segmentations').update(match.id, payload)
    : await pb.collection('segmentations').create(payload);
  return SegmentationRecordSchema.parse(record);
};

export const deleteSegmentationsForImage = async (
  imageId: string,
  tagsToKeep: readonly string[],
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const ids = segIdsToPrune(existing, tagsToKeep);
  await Promise.all(
    ids.map((id) => pb.collection('segmentations').delete(id)),
  );
};

export const deleteAllSegmentationsForImage = (
  imageId: string,
): Promise<void> => deleteSegmentationsForImage(imageId, []);

export const deleteSegmentationByImageTag = async (
  imageId: string,
  tag: string,
): Promise<void> => {
  const raw = await pb
    .collection('segmentations')
    .getFullList({ filter: `image="${imageId}"` });
  const existing = parseList(SegmentationRecordSchema, raw);
  const match = findSegByTag(existing, tag);
  if (!match) return;
  await pb.collection('segmentations').delete(match.id);
};

export const updateImagePosition = async (
  id: string,
  pos: { x: number; y: number },
): Promise<ImageRecord> => {
  const raw = await pb.collection('images').update(id, pos);
  return PlacementRecordSchema.parse(raw);
};

export const updateVideoPosition = async (
  id: string,
  pos: { x: number; y: number },
): Promise<VideoRecord> => {
  const raw = await pb.collection('videos').update(id, pos);
  return PlacementRecordSchema.parse(raw);
};

const buildMediaForm = (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
): FormData => {
  const form = new FormData();
  form.append('file', file);
  form.append('name', meta.name);
  form.append('x', String(meta.x));
  form.append('y', String(meta.y));
  form.append('width', String(meta.width));
  form.append('height', String(meta.height));
  return form;
};

export class UploadAbortError extends Error {
  override name = 'AbortError';
  constructor() {
    super('upload aborted');
  }
}

const PbErrorSchema = z.object({
  message: z.string().optional(),
  data: z.record(z.object({ message: z.string().optional() }).passthrough()).optional(),
});

const buildUploadError = (status: number, statusText: string, body: string): Error => {
  let detail = '';
  try {
    const parsed = PbErrorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      const parts: string[] = [];
      if (parsed.data.message) parts.push(parsed.data.message);
      if (parsed.data.data) {
        for (const [field, info] of Object.entries(parsed.data.data)) {
          if (info.message) parts.push(`${field}: ${info.message}`);
        }
      }
      detail = parts.join(' · ');
    }
  } catch {
    
  }
  if (!detail) detail = body.slice(0, 400).trim();
  const suffix = detail ? ` — ${detail}` : '';
  const err = new Error(`upload failed: ${status} ${statusText}${suffix}`);
  Object.assign(err, { responseBody: body });
  return err;
};

const uploadWithProgress = (
  collection: string,
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PB_URL}/api/collections/${collection}/records`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.upload.onload = () => onProgress(1);
    }
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        reject(buildUploadError(xhr.status, xhr.statusText, xhr.responseText || ''));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('network error during upload (connection dropped or CORS blocked)'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadAbortError());
    };
    xhr.send(buildMediaForm(file, meta));
  });

export const createImage = async (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ImageRecord> => {
  const raw = await uploadWithProgress('images', file, meta, onProgress, signal);
  return PlacementRecordSchema.parse(raw);
};

export const createVideo = async (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<VideoRecord> => {
  const raw = await uploadWithProgress('videos', file, meta, onProgress, signal);
  return PlacementRecordSchema.parse(raw);
};

export const deleteImage = async (id: string): Promise<ImageRecord> => {
  const raw = await pb
    .collection('images')
    .update(id, { deleted_at: new Date().toISOString() });
  return PlacementRecordSchema.parse(raw);
};

export const deleteVideo = async (id: string): Promise<VideoRecord> => {
  const raw = await pb
    .collection('videos')
    .update(id, { deleted_at: new Date().toISOString() });
  return PlacementRecordSchema.parse(raw);
};

export const restoreImage = async (id: string): Promise<ImageRecord> => {
  const raw = await pb.collection('images').update(id, { deleted_at: null });
  return PlacementRecordSchema.parse(raw);
};

export const restoreVideo = async (id: string): Promise<VideoRecord> => {
  const raw = await pb.collection('videos').update(id, { deleted_at: null });
  return PlacementRecordSchema.parse(raw);
};

export const hardDeleteImage = (id: string): Promise<boolean> =>
  pb.collection('images').delete(id);

export const hardDeleteVideo = (id: string): Promise<boolean> =>
  pb.collection('videos').delete(id);

export const listTrashed = async (opts: {
  olderThanMs: number;
}): Promise<{ images: ImageRecord[]; videos: VideoRecord[] }> => {
  const cutoff = new Date(Date.now() - opts.olderThanMs).toISOString();
  const filter = `deleted_at != null && deleted_at != "" && deleted_at < "${cutoff}"`;
  const [imgs, vids] = await Promise.all([
    pb.collection('images').getFullList({ filter }),
    pb.collection('videos').getFullList({ filter }),
  ]);
  return {
    images: parseList(PlacementRecordSchema, imgs),
    videos: parseList(PlacementRecordSchema, vids),
  };
};
