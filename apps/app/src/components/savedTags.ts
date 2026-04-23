import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

const STORAGE_KEY = 'netrart:saved-tags:v1';
const MAX_SAVED = 200;

const SavedTagsSchema = z.array(z.string().min(1).max(80));

const readStored = (): string[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = SavedTagsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

const writeStored = (tags: string[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // Ignore quota / serialization errors — saved tags are non-critical.
  }
};

const normalize = (tag: string) => tag.trim().toLowerCase();

export const sanitizeTag = (tag: string) => tag.trim().replace(/\s+/g, ' ');

/**
 * Persisted history of every tag the user has committed. Most-recent first
 * so the suggestion list naturally surfaces what was just used.
 */
export function useSavedTags() {
  const [tags, setTags] = useState<string[]>(readStored);

  // Sync across multiple windows/tabs via the storage event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setTags(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const remember = useCallback((rawTag: string) => {
    const clean = sanitizeTag(rawTag);
    if (!clean) return;
    setTags((prev) => {
      const key = normalize(clean);
      const next = [clean, ...prev.filter((t) => normalize(t) !== key)];
      const trimmed = next.slice(0, MAX_SAVED);
      writeStored(trimmed);
      return trimmed;
    });
  }, []);

  const remove = useCallback((rawTag: string) => {
    const key = normalize(rawTag);
    if (!key) return;
    setTags((prev) => {
      const next = prev.filter((t) => normalize(t) !== key);
      if (next.length === prev.length) return prev;
      writeStored(next);
      return next;
    });
  }, []);

  // Rename keeps the old entry's position in the recency list. If the
  // target name already exists the two entries collapse — winner is the
  // one we just renamed into, so callers can safely normalize typos.
  const rename = useCallback(
    (oldTag: string, rawNext: string): boolean => {
      const oldKey = normalize(oldTag);
      const nextClean = sanitizeTag(rawNext);
      if (!oldKey || !nextClean) return false;
      const nextKey = normalize(nextClean);
      if (oldKey === nextKey) {
        // Same tag, possibly different casing — just update casing.
        setTags((prev) => {
          const idx = prev.findIndex((t) => normalize(t) === oldKey);
          if (idx === -1 || prev[idx] === nextClean) return prev;
          const next = prev.slice();
          next[idx] = nextClean;
          writeStored(next);
          return next;
        });
        return true;
      }
      setTags((prev) => {
        const idx = prev.findIndex((t) => normalize(t) === oldKey);
        if (idx === -1) return prev;
        const collapse = prev.findIndex((t) => normalize(t) === nextKey);
        const next = prev.slice();
        next[idx] = nextClean;
        if (collapse !== -1 && collapse !== idx) {
          next.splice(collapse, 1);
        }
        writeStored(next);
        return next;
      });
      return true;
    },
    [],
  );

  const search = useCallback(
    (query: string, exclude: string[] = [], limit = 6): string[] => {
      const q = normalize(query);
      if (!q) return [];
      const skip = new Set(exclude.map(normalize));
      const out: string[] = [];
      let prefixCount = 0;
      // Prefix matches first (preserve recency order), then substring matches.
      for (const t of tags) {
        if (skip.has(normalize(t))) continue;
        if (normalize(t).startsWith(q)) {
          out.push(t);
          prefixCount += 1;
          if (out.length >= limit) return out;
        }
      }
      for (const t of tags) {
        if (out.length >= limit) break;
        const n = normalize(t);
        if (skip.has(n)) continue;
        if (n.startsWith(q)) continue;
        if (n.includes(q)) out.push(t);
      }
      // Sort guarantee: prefix matches stay above substring matches; we already
      // appended in that order, so just hand back as-is. The local var is here
      // so the intent is grep-able.
      void prefixCount;
      return out;
    },
    [tags],
  );

  return { tags, remember, remove, rename, search };
}

/**
 * Stable HSL color for a tag string. Uses FNV-1a 32-bit so equal text
 * always maps to the same swatch. We jitter hue, saturation, and
 * lightness from different bits of the hash — hue alone collides too
 * often for a long tag list; adding s/l variance expands the visual
 * space so even close-hue neighbours read differently.
 *
 * `bg` / `fg` / `border` tune the pill look; `accent` is the opaque base
 * hue so mask fills and bounding boxes read the same identity as the pill.
 */
export function colorForTag(
  tag: string,
): { bg: string; fg: string; border: string; accent: string } {
  const key = tag.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const u = hash >>> 0;
  // Golden-angle hue step improves perceptual separation between tags
  // whose hashes fall close together numerically.
  const hue = Math.floor(((u % 1000) * 137.508) % 360);
  const sat = 58 + ((u >>> 10) & 0x1f); // 58-89
  const lit = 48 + ((u >>> 17) & 0x0f); // 48-63
  const accentLit = Math.max(42, lit - 4);
  return {
    bg: `hsl(${hue} ${sat}% ${lit}% / 0.22)`,
    fg: `hsl(${hue} ${Math.min(95, sat + 10)}% 88%)`,
    border: `hsl(${hue} ${sat}% ${Math.min(72, lit + 8)}% / 0.55)`,
    accent: `hsl(${hue} ${sat}% ${accentLit}%)`,
  };
}
