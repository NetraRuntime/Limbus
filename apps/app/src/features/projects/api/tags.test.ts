import { describe, it, expect, vi, beforeEach } from 'vitest';

const collectionFns = {
  getFullList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../../lib/pb', () => ({
  pb: { collection: () => collectionFns },
}));

import { listTags, createTag, deleteTagById } from './tags';

beforeEach(() => Object.values(collectionFns).forEach((f) => f.mockReset()));

describe('tags api', () => {
  it('listTags filters by project', async () => {
    collectionFns.getFullList.mockResolvedValueOnce([]);
    await listTags('proj_1');
    expect(collectionFns.getFullList).toHaveBeenCalledWith({
      filter: 'project="proj_1"',
      sort: '-updated',
    });
  });

  it('createTag posts project + name + color', async () => {
    collectionFns.create.mockResolvedValueOnce({
      id: 't1',
      collectionId: 'tc',
      project: 'proj_1',
      name: 'Cell',
      color: '#a0c4ff',
      created: '',
      updated: '',
    });
    const out = await createTag('proj_1', { name: 'Cell', color: '#a0c4ff' });
    expect(collectionFns.create).toHaveBeenCalledWith({
      project: 'proj_1',
      name: 'Cell',
      color: '#a0c4ff',
    });
    expect(out.name).toBe('Cell');
  });

  it('deleteTagById delegates', async () => {
    collectionFns.delete.mockResolvedValueOnce(true);
    await deleteTagById('t1');
    expect(collectionFns.delete).toHaveBeenCalledWith('t1');
  });
});
