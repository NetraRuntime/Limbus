import PocketBase, { type RecordModel } from 'pocketbase';

// Default to same-origin relative calls. nginx (or vite dev proxy) routes
// /api and /_/ to the PocketBase container, so the frontend doesn't need
// to know PB's real URL at runtime. Override with VITE_PB_URL to point at
// a remote PB (e.g. for staging or when running without a proxy).
const rawUrl = (import.meta.env.VITE_PB_URL as string | undefined) ?? '';
// Inside the Tauri webview the app is served from tauri://localhost, so
// relative /api calls can't reach the PocketBase sidecar. Detect Tauri and
// point directly at the sidecar's loopback address.
const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
export const PB_URL = (rawUrl || (isTauri ? 'http://127.0.0.1:8090' : '')).replace(/\/+$/, '');

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

// Disable automatic request cancellation — StrictMode's double-effect in dev
// would otherwise cancel the very first fetch before it resolves.
pb.autoCancellation(false);

// Images and videos share an identical placement shape; only the collection
// and MIME types differ. Keep the layout fields consolidated so the Canvas
// can treat both records uniformly.
type PlacementFields = {
  file: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageRecord = RecordModel & PlacementFields;
export type VideoRecord = RecordModel & PlacementFields;
export type MediaKind = 'image' | 'video';

// Build the public file URL directly so we don't depend on the SDK's URL
// helper (its casing has drifted between versions — getUrl vs getURL).
// Empty PB_URL yields a same-origin path ('/api/files/…'), which the browser
// resolves against the page origin.
const fileUrl = (record: RecordModel & { file: string }): string =>
  `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(record.file)}`;

export const imageFileUrl = fileUrl as (r: ImageRecord) => string;
export const videoFileUrl = fileUrl as (r: VideoRecord) => string;

export const listImages = (): Promise<ImageRecord[]> =>
  pb.collection('images').getFullList<ImageRecord>({ sort: 'created' });

export const listVideos = (): Promise<VideoRecord[]> =>
  pb.collection('videos').getFullList<VideoRecord>({ sort: 'created' });

export const updateImagePosition = (
  id: string,
  pos: { x: number; y: number },
): Promise<ImageRecord> => pb.collection('images').update<ImageRecord>(id, pos);

export const updateVideoPosition = (
  id: string,
  pos: { x: number; y: number },
): Promise<VideoRecord> => pb.collection('videos').update<VideoRecord>(id, pos);

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

// Thrown when an upload is cancelled via AbortSignal. Callers can use
// `.name === 'AbortError'` to distinguish cancellation from real failures.
export class UploadAbortError extends Error {
  override name = 'AbortError';
  constructor() {
    super('upload aborted');
  }
}

// Uploads via XMLHttpRequest so the caller can observe byte-level progress —
// fetch() (what the SDK uses) can't report upload progress in browsers.
// An optional AbortSignal aborts the in-flight request (rejects with
// UploadAbortError).
const uploadWithProgress = <T>(
  collection: string,
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<T> =>
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
      // On loopback (localhost / 127.0.0.1) the upload body is handed to the
      // OS in one shot; some browsers fire a single early `progress` event
      // and then jump straight to `load` without reporting 100%. Hooking
      // `upload.onload` gives us a deterministic signal that the body is
      // fully sent so the UI can transition to a "finalizing" state instead
      // of looking stuck at the last reported percentage.
      xhr.upload.onload = () => onProgress(1);
    }
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        // PB returns { code, message, data: { <field>: { code, message } } }
        // on validation errors; surface just the human-readable bits so the
        // chip/console shows an actionable line instead of raw JSON.
        const body = xhr.responseText || '';
        let detail = '';
        try {
          const parsed = JSON.parse(body) as {
            message?: string;
            data?: Record<string, { message?: string } | unknown>;
          };
          const parts: string[] = [];
          if (parsed.message) parts.push(parsed.message);
          if (parsed.data && typeof parsed.data === 'object') {
            for (const [field, info] of Object.entries(parsed.data)) {
              const msg = (info as { message?: string } | null)?.message;
              if (msg) parts.push(`${field}: ${msg}`);
            }
          }
          detail = parts.join(' · ');
        } catch {
          // Not JSON — fall back to a trimmed snippet.
          detail = body.slice(0, 400).trim();
        }
        const suffix = detail ? ` — ${detail}` : '';
        const err = new Error(
          `upload failed: ${xhr.status} ${xhr.statusText}${suffix}`,
        );
        // Stash the raw body so devtools users can inspect the full payload
        // even when the UI / error message truncates it.
        (err as Error & { responseBody?: string }).responseBody = body;
        reject(err);
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

export const createImage = (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<ImageRecord> =>
  uploadWithProgress<ImageRecord>('images', file, meta, onProgress, signal);

export const createVideo = (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<VideoRecord> =>
  uploadWithProgress<VideoRecord>('videos', file, meta, onProgress, signal);

export const deleteImage = (id: string): Promise<boolean> =>
  pb.collection('images').delete(id);

export const deleteVideo = (id: string): Promise<boolean> =>
  pb.collection('videos').delete(id);
