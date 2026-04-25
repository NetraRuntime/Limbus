import { z } from 'zod';
import { pb } from '../../../lib/pb';

export const TagRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  name: z.string(),
  color: z.string(),
  created: z.string(),
  updated: z.string(),
});
export type TagRecord = z.infer<typeof TagRecordSchema>;

export const listTags = async (projectId: string): Promise<TagRecord[]> => {
  const raw = await pb.collection('tags').getFullList({
    filter: pb.filter('project={:project}', { project: projectId }),
    sort: '-updated',
  });
  if (!Array.isArray(raw)) return [];
  const out: TagRecord[] = [];
  for (const item of raw) {
    const parsed = TagRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const createTag = async (
  projectId: string,
  input: { name: string; color: string },
): Promise<TagRecord> => {
  const raw = await pb.collection('tags').create({ project: projectId, ...input });
  return TagRecordSchema.parse(raw);
};

export const updateTag = async (
  id: string,
  input: { name?: string; color?: string },
): Promise<TagRecord> => {
  const raw = await pb.collection('tags').update(id, input);
  return TagRecordSchema.parse(raw);
};

export const deleteTagById = async (id: string): Promise<void> => {
  await pb.collection('tags').delete(id);
};
