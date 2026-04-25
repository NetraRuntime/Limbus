// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateLegacySavedTags, LEGACY_KEY } from './legacyTagsMigration';

beforeEach(() => {
  localStorage.clear();
});

describe('migrateLegacySavedTags', () => {
  it('does nothing when key absent', async () => {
    const create = vi.fn();
    await migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create });
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing when project already has tags', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell']));
    const create = vi.fn();
    await migrateLegacySavedTags('proj_1', { existingCount: 5, createTag: create });
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['cell']));
  });

  it('imports legacy tags and clears the key on success', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell', 'wall']));
    const create = vi.fn().mockResolvedValue(undefined);
    await migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create });
    expect(create).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('keeps the key on partial failure', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['cell', 'wall']));
    const create = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    await expect(
      migrateLegacySavedTags('proj_1', { existingCount: 0, createTag: create }),
    ).rejects.toThrow('boom');
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify(['cell', 'wall']));
  });
});
