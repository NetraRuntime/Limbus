import { useCallback, useEffect, useState } from 'react';
import {
  listTags,
  createTag,
  updateTag,
  deleteTagById,
  type TagRecord,
} from '../features/projects/api/tags';
import { migrateLegacySavedTags } from '../features/projects/lib/legacyTagsMigration';
import { pb } from '../lib/pb';

export const sanitizeTag = (tag: string) => tag.trim().replace(/\s+/g, ' ');

const normalize = (tag: string) => tag.trim().toLowerCase();

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

const MAX_SAVED = 200;

type SavedTagsApi = {
  tags: string[];
  remember: (raw: string) => Promise<void>;
  remove: (raw: string) => Promise<void>;
  rename: (oldTag: string, rawNext: string) => Promise<boolean>;
  search: (query: string, exclude?: string[], limit?: number) => string[];
};

export function useSavedTags(projectId: string): SavedTagsApi {
  const [records, setRecords] = useState<TagRecord[]>([]);

  // Initial load + legacy localStorage migration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = await listTags(projectId);
      if (cancelled) return;
      setRecords(initial);
      try {
        await migrateLegacySavedTags(projectId, {
          existingCount: initial.length,
          createTag: async (input) => {
            const created = await createTag(projectId, input);
            if (!cancelled) setRecords((prev) => [created, ...prev]);
          },
        });
      } catch (err) {
        console.warn('[savedTags] legacy migration failed; will retry next launch', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Real-time subscription — keeps state consistent across windows/tabs.
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    pb.collection('tags')
      .subscribe('*', (e) => {
        if (cancelled) return;
        if (e.record['project'] !== projectId) return;
        setRecords((prev) => {
          const idx = prev.findIndex((r) => r.id === e.record.id);
          if (e.action === 'delete') {
            return idx >= 0 ? prev.filter((r) => r.id !== e.record.id) : prev;
          }
          const next = prev.slice();
          if (idx >= 0) next[idx] = e.record as unknown as TagRecord;
          else next.unshift(e.record as unknown as TagRecord);
          return next;
        });
      })
      .then((u) => {
        unsub = u as unknown as () => void;
        if (cancelled) unsub?.();
      })
      .catch((err) => console.warn('[savedTags] subscribe failed', err));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [projectId]);

  const remember = useCallback(
    async (rawTag: string) => {
      const clean = sanitizeTag(rawTag);
      if (!clean) return;
      const lower = clean.toLowerCase();
      const existing = records.find((r) => r.name.toLowerCase() === lower);
      if (existing) return;
      const created = await createTag(projectId, {
        name: clean,
        color: colorForTag(clean).accent,
      });
      setRecords((prev) => [created, ...prev].slice(0, MAX_SAVED));
    },
    [projectId, records],
  );

  // `remove` matches the original API name used by SavedTagsPopover.
  const remove = useCallback(
    async (rawTag: string) => {
      const lower = normalize(rawTag);
      if (!lower) return;
      const target = records.find((r) => r.name.toLowerCase() === lower);
      if (!target) return;
      await deleteTagById(target.id);
      setRecords((prev) => prev.filter((r) => r.id !== target.id));
    },
    [records],
  );

  // `rename` keeps the original entry's position. Returns true when a rename
  // occurred, false when the inputs were empty or unchanged.
  const rename = useCallback(
    async (oldTag: string, rawNext: string): Promise<boolean> => {
      const oldKey = normalize(oldTag);
      const nextClean = sanitizeTag(rawNext);
      if (!oldKey || !nextClean) return false;
      const nextKey = normalize(nextClean);
      const target = records.find((r) => r.name.toLowerCase() === oldKey);
      if (!target) return false;

      if (oldKey === nextKey) {
        // Same tag, possibly different casing — just update the display name.
        if (target.name === nextClean) return false;
        const updated = await updateTag(target.id, { name: nextClean });
        setRecords((prev) => {
          const idx = prev.findIndex((r) => r.id === target.id);
          if (idx === -1) return prev;
          const next = prev.slice();
          next[idx] = updated;
          return next;
        });
        return true;
      }

      // Different target name: collapse any existing duplicate into this one.
      const updated = await updateTag(target.id, {
        name: nextClean,
        color: colorForTag(nextClean).accent,
      });
      setRecords((prev) => {
        const idx = prev.findIndex((r) => r.id === target.id);
        if (idx === -1) return prev;
        // Remove any existing record with the same (new) key — dedup.
        const collapse = prev.findIndex(
          (r) => r.id !== target.id && r.name.toLowerCase() === nextKey,
        );
        const next = prev.slice();
        next[idx] = updated;
        if (collapse !== -1) next.splice(collapse > idx ? collapse : collapse, 1);
        return next;
      });
      return true;
    },
    [records],
  );

  // `search` is derived from local state; stays synchronous.
  const search = useCallback(
    (query: string, exclude: string[] = [], limit = 6): string[] => {
      const q = normalize(query);
      if (!q) return [];
      const skip = new Set(exclude.map(normalize));
      const names = records.map((r) => r.name);
      const out: string[] = [];
      // Prefix matches first (preserve recency order), then substring matches.
      for (const t of names) {
        if (skip.has(normalize(t))) continue;
        if (normalize(t).startsWith(q)) {
          out.push(t);
          if (out.length >= limit) return out;
        }
      }
      for (const t of names) {
        if (out.length >= limit) break;
        const n = normalize(t);
        if (skip.has(n)) continue;
        if (n.startsWith(q)) continue;
        if (n.includes(q)) out.push(t);
      }
      return out;
    },
    [records],
  );

  return {
    tags: records.map((r) => r.name),
    remember,
    remove,
    rename,
    search,
  };
}
