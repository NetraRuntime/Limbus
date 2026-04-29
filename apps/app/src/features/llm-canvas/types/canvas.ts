import { z } from 'zod';

export const NodeKinds = ['start', 'step'] as const;
export type NodeKind = (typeof NodeKinds)[number];

export const MessageRoles = ['system', 'user', 'assistant'] as const;
export type MessageRole = (typeof MessageRoles)[number];

export const ConversationMessageSchema = z.object({
  role: z.enum([...MessageRoles]),
  content: z.string().default(''),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// A single training example is now a multi-turn conversation.
// Legacy `{ input, output }` rows are migrated transparently so older
// records continue to load.
export const NodeExampleSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.messages)) return obj;
    if ('input' in obj || 'output' in obj) {
      const input = typeof obj.input === 'string' ? obj.input : '';
      const output = typeof obj.output === 'string' ? obj.output : '';
      const messages: ConversationMessage[] = [];
      if (input !== '') messages.push({ role: 'user', content: input });
      if (output !== '') messages.push({ role: 'assistant', content: output });
      return { messages };
    }
  }
  return raw;
}, z.object({ messages: z.array(ConversationMessageSchema).default([]) }));
export type NodeExample = z.infer<typeof NodeExampleSchema>;

export const NodeRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  project: z.string(),
  kind: z.enum([...NodeKinds]).catch('step'),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  // Few-shot input/output pairs edited from the inspector sidebar.
  // `.catch([])` keeps legacy rows (without the column) parsing.
  examples: z.array(NodeExampleSchema).catch([]),
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
    examples: z.array(NodeExampleSchema),
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
