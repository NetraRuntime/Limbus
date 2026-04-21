import PocketBase, { type RecordModel } from 'pocketbase';

// Default to same-origin relative calls. nginx (or vite dev proxy) routes
// /api and /_/ to the PocketBase container, so the frontend doesn't need
// to know PB's real URL at runtime. Override with VITE_PB_URL to point at
// a remote PB (e.g. for staging or when running without a proxy).
const rawUrl = (import.meta.env.VITE_PB_URL as string | undefined) ?? '';
export const PB_URL = rawUrl.replace(/\/+$/, ''); // '' | 'http://host[:port]'

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

// Disable automatic request cancellation — StrictMode's double-effect in dev
// would otherwise cancel the very first fetch before it resolves.
pb.autoCancellation(false);

export type ImageRecord = RecordModel & {
  file: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// Build the public file URL directly so we don't depend on the SDK's URL
// helper (its casing has drifted between versions — getUrl vs getURL).
// Empty PB_URL yields a same-origin path ('/api/files/…'), which the browser
// resolves against the page origin.
export const imageFileUrl = (record: ImageRecord): string =>
  `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(record.file)}`;

export const listImages = (): Promise<ImageRecord[]> =>
  pb.collection('images').getFullList<ImageRecord>({ sort: 'created' });

export const createImage = (
  file: File,
  meta: { x: number; y: number; width: number; height: number; name: string },
): Promise<ImageRecord> => {
  const form = new FormData();
  form.append('file', file);
  form.append('name', meta.name);
  form.append('x', String(meta.x));
  form.append('y', String(meta.y));
  form.append('width', String(meta.width));
  form.append('height', String(meta.height));
  return pb.collection('images').create<ImageRecord>(form);
};
