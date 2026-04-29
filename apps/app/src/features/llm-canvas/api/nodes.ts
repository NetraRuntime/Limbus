import { pb } from '../../../lib/pb';
import {
  NodeRecordSchema,
  type NewNodeInput,
  type NodeRecord,
  type UpdateNodeInput,
} from '../types/canvas';

const parse = (raw: unknown): NodeRecord => NodeRecordSchema.parse(raw);

export const listNodes = async (projectId: string): Promise<NodeRecord[]> => {
  const raw = await pb.collection('canvas_nodes').getFullList({
    filter: `project = "${projectId}"`,
    sort: 'created',
  });
  if (!Array.isArray(raw)) return [];
  const out: NodeRecord[] = [];
  for (const item of raw) {
    const parsed = NodeRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const createNode = async (input: NewNodeInput): Promise<NodeRecord> => {
  const raw = await pb.collection('canvas_nodes').create(input);
  return parse(raw);
};

export const updateNode = async (
  id: string,
  input: UpdateNodeInput,
): Promise<NodeRecord> => {
  const raw = await pb.collection('canvas_nodes').update(id, input);
  return parse(raw);
};

export const deleteNode = async (id: string): Promise<void> => {
  await pb.collection('canvas_nodes').delete(id);
};

/** Race-safe via partial unique index on (project) where kind='start'. */
export const ensureStartNode = async (
  projectId: string,
): Promise<NodeRecord> => {
  try {
    const raw = await pb
      .collection('canvas_nodes')
      .getFirstListItem(`project = "${projectId}" && kind = "start"`);
    return parse(raw);
  } catch {
    return createNode({
      project: projectId,
      kind: 'start',
      name: 'Start',
      x: 0,
      y: 0,
    });
  }
};
