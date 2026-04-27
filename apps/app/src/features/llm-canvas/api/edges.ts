import { pb } from '../../../lib/pb';
import {
  EdgeRecordSchema,
  type EdgeRecord,
  type NewEdgeInput,
} from '../types/canvas';

const parse = (raw: unknown): EdgeRecord => EdgeRecordSchema.parse(raw);

export const listEdges = async (projectId: string): Promise<EdgeRecord[]> => {
  const raw = await pb.collection('canvas_edges').getFullList({
    filter: `project = "${projectId}"`,
    sort: 'created',
  });
  if (!Array.isArray(raw)) return [];
  const out: EdgeRecord[] = [];
  for (const item of raw) {
    const parsed = EdgeRecordSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export const createEdge = async (input: NewEdgeInput): Promise<EdgeRecord> => {
  const raw = await pb.collection('canvas_edges').create(input);
  return parse(raw);
};

export const updateEdge = async (
  id: string,
  patch: { from_node?: string; to_node?: string },
): Promise<EdgeRecord> => {
  const raw = await pb.collection('canvas_edges').update(id, patch);
  return parse(raw);
};

export const deleteEdge = async (id: string): Promise<void> => {
  await pb.collection('canvas_edges').delete(id);
};
