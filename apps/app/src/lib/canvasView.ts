import { z } from 'zod';
import type { View } from '../InfiniteCanvas';

export const VIEW_STORAGE_KEY = 'netrart:canvas:view:v1';
export const VIEW_PERSIST_DEBOUNCE_MS = 200;

const StoredViewSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().finite().positive(),
});

export const readStoredView = (): View | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = StoredViewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const writeStoredView = (v: View) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // ignore quota / privacy errors
  }
};

export const getInitialView = (): View => {
  const stored = readStoredView();
  if (stored) return stored;
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: w / 2, y: h / 2, scale: 1 };
};

export const formatZoom = (scale: number) => {
  if (scale >= 1) return `${(scale * 100).toFixed(0)}%`;
  if (scale >= 0.01) return `${(scale * 100).toFixed(1)}%`;
  return scale.toExponential(1);
};

export const formatCoord = (n: number | undefined) => {
  if (n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e5) return n.toExponential(1);
  return n.toFixed(abs < 10 ? 2 : abs < 1000 ? 1 : 0);
};
