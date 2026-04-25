import { z } from 'zod';

export const LEGACY_KEY = 'netrart:saved-tags:v1';

const Schema = z.array(z.string().min(1).max(80));

const colorForTag = (name: string): string => {
  // Stable hash → hue. Keeps legacy tags visually consistent post-migration.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 60%)`;
};

type Deps = {
  existingCount: number;
  createTag: (input: { name: string; color: string }) => Promise<unknown>;
};

export async function migrateLegacySavedTags(
  _projectId: string,
  deps: Deps,
): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (deps.existingCount > 0) return;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  let tags: string[] = [];
  try {
    const parsed = Schema.safeParse(JSON.parse(raw));
    if (parsed.success) tags = parsed.data;
  } catch {
    return;
  }
  if (tags.length === 0) {
    localStorage.removeItem(LEGACY_KEY);
    return;
  }
  for (const name of tags) {
    await deps.createTag({ name, color: colorForTag(name) });
  }
  localStorage.removeItem(LEGACY_KEY);
}
