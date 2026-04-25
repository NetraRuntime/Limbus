import { describe, it, expect, vi, beforeEach } from 'vitest';

const collectionFns = {
  getFullList: vi.fn(),
  getOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../../lib/pb', () => ({
  pb: { collection: () => collectionFns },
  PB_URL: 'http://test.local',
}));

import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  touchLastOpenedAt,
  thumbnailUrl,
} from './projects';

beforeEach(() => {
  Object.values(collectionFns).forEach((fn) => fn.mockReset());
});

describe('projects api', () => {
  it('listProjects returns parsed records', async () => {
    collectionFns.getFullList.mockResolvedValueOnce([
      {
        id: 'p1',
        collectionId: 'pc',
        name: 'Cells',
        color: 'blue',
        icon: 'ri-microscope-line',
        labels: ['biology'],
        thumbnail: '',
        created: '2026-01-01',
        updated: '2026-01-01',
      },
    ]);
    const result = await listProjects();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Cells');
  });

  it('createProject submits expected fields', async () => {
    collectionFns.create.mockResolvedValueOnce({
      id: 'p2',
      collectionId: 'pc',
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
      thumbnail: '',
      created: '2026-01-02',
      updated: '2026-01-02',
    });
    const result = await createProject({
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
    });
    expect(collectionFns.create).toHaveBeenCalledWith({
      name: 'Cars',
      color: 'amber',
      icon: 'ri-car-line',
      labels: [],
    });
    expect(result.id).toBe('p2');
  });

  it('touchLastOpenedAt updates the timestamp', async () => {
    collectionFns.update.mockResolvedValueOnce({
      id: 'p1',
      collectionId: 'pc',
      name: 'Cells',
      color: 'blue',
      icon: 'ri-microscope-line',
      labels: [],
      thumbnail: '',
      last_opened_at: '2026-04-25T00:00:00Z',
      created: '2026-01-01',
      updated: '2026-04-25T00:00:00Z',
    });
    await touchLastOpenedAt('p1');
    expect(collectionFns.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ last_opened_at: expect.any(String) }),
    );
  });

  it('thumbnailUrl returns empty string when no thumbnail', () => {
    expect(
      thumbnailUrl({
        id: 'p1',
        collectionId: 'pc',
        name: 'x',
        color: 'slate',
        icon: 'ri-folder-3-line',
        labels: [],
        thumbnail: '',
        created: '',
        updated: '',
      }),
    ).toBe('');
  });

  it('thumbnailUrl returns a PB file URL when present', () => {
    const url = thumbnailUrl({
      id: 'p1',
      collectionId: 'pc',
      name: 'x',
      color: 'slate',
      icon: 'ri-folder-3-line',
      labels: [],
      thumbnail: 'thumb_abc.webp',
      created: '',
      updated: '',
    });
    expect(url).toBe('http://test.local/api/files/pc/p1/thumb_abc.webp');
  });
});
