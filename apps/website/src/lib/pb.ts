import PocketBase from 'pocketbase';

// Default to same-origin relative calls. The Vite dev proxy (and nginx in
// prod) route /api and /_/ to the PocketBase service. Override with
// VITE_PB_URL to point at a remote PB (e.g. staging, or production web
// pointing at a separate online DB for license/auth in the future).
const rawUrl = (import.meta.env.VITE_PB_URL as string | undefined) ?? '';
export const PB_URL = rawUrl.replace(/\/+$/, '');

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

// Disable automatic request cancellation — StrictMode's double-effect in
// dev would otherwise cancel the very first fetch before it resolves.
pb.autoCancellation(false);
