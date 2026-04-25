import { pb, PB_URL } from '../../../lib/pb';
import {
  ProjectRecordSchema,
  type ProjectRecord,
  type NewProjectInput,
  type UpdateProjectInput,
} from '../types/project';

const parseOne = (raw: unknown): ProjectRecord => ProjectRecordSchema.parse(raw);

export const listProjects = async (): Promise<ProjectRecord[]> => {
  const raw = await pb.collection('projects').getFullList({ sort: '-last_opened_at,-created' });
  if (!Array.isArray(raw)) return [];
  const out: ProjectRecord[] = [];
  for (const item of raw) {
    const parsed = ProjectRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const getProject = async (id: string): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').getOne(id);
  return parseOne(raw);
};

export const createProject = async (input: NewProjectInput): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').create(input);
  return parseOne(raw);
};

export const updateProject = async (
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').update(id, input);
  return parseOne(raw);
};

export const deleteProject = async (id: string): Promise<void> => {
  await pb.collection('projects').delete(id);
};

export const touchLastOpenedAt = async (id: string): Promise<ProjectRecord> => {
  const raw = await pb.collection('projects').update(id, {
    last_opened_at: new Date().toISOString(),
  });
  return parseOne(raw);
};

export const uploadThumbnail = async (
  id: string,
  blob: Blob,
): Promise<ProjectRecord> => {
  const form = new FormData();
  form.append('thumbnail', blob, 'thumbnail.webp');
  const raw = await pb.collection('projects').update(id, form);
  return parseOne(raw);
};

export const thumbnailUrl = (record: ProjectRecord): string => {
  if (!record.thumbnail) return '';
  return `${PB_URL}/api/files/${record.collectionId}/${record.id}/${encodeURIComponent(record.thumbnail)}`;
};
