import PocketBase from 'pocketbase';
import { z } from 'zod';

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

const PlacementRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  collectionName: z.string(),
  created: z.string(),
  updated: z.string(),
  file: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type ImageRecord = z.infer<typeof PlacementRecordSchema>;
export type VideoRecord = z.infer<typeof PlacementRecordSchema>;
export type MediaKind = 'image' | 'video';

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

export const listImages = async (): Promise<ImageRecord[]> => {
  const raw = await pb.collection('images').getFullList({ sort: 'created' });
  return parseList(PlacementRecordSchema, raw);
};

export const listVideos = async (): Promise<VideoRecord[]> => {
  const raw = await pb.collection('videos').getFullList({ sort: 'created' });
  return parseList(PlacementRecordSchema, raw);
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

export const deleteImage = (id: string): Promise<boolean> =>
  pb.collection('images').delete(id);

export const deleteVideo = (id: string): Promise<boolean> =>
  pb.collection('videos').delete(id);
