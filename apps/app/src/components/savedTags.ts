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

  return { tags, remember, search };
}

/**
 * Stable HSL color for a tag string. Uses FNV-1a 32-bit so equal text
 * always maps to the same hue without pulling in a hashing library.
 */
export function colorForTag(tag: string): { bg: string; fg: string; border: string } {
  const key = tag.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue} 70% 55% / 0.22)`,
    fg: `hsl(${hue} 80% 88%)`,
    border: `hsl(${hue} 70% 60% / 0.55)`,
  };
}
