import { z } from 'zod';

export const NodeKinds = ['start', 'step'] as const;
export type NodeKind = (typeof NodeKinds)[number];

export const NodeRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  kind: z.enum([...NodeKinds]).catch('step'),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  created: z.string(),
  updated: z.string(),
});

export type NodeRecord = z.infer<typeof NodeRecordSchema>;

export const NewNodeInputSchema = z.object({
  id: z.string().optional(),
  project: z.string(),
  kind: z.enum(NodeKinds),
  name: z.string().min(1).max(256),
  x: z.number(),
  y: z.number(),
});
export type NewNodeInput = z.infer<typeof NewNodeInputSchema>;

export const UpdateNodeInputSchema = z
  .object({
    name: z.string().min(1).max(256),
    x: z.number(),
    y: z.number(),
  })
  .partial();
export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;

export const EdgeRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  from_node: z.string(),
  to_node: z.string(),
  created: z.string(),
  updated: z.string(),
});
export type EdgeRecord = z.infer<typeof EdgeRecordSchema>;

export const NewEdgeInputSchema = z.object({
  id: z.string().optional(),
  project: z.string(),
  from_node: z.string(),
  to_node: z.string(),
});
export type NewEdgeInput = z.infer<typeof NewEdgeInputSchema>;
