import { z } from 'zod';

export const ProjectColors = ['slate', 'blue', 'amber', 'emerald', 'rose', 'violet'] as const;
export type ProjectColor = (typeof ProjectColors)[number];

export const ProjectIcons = [
  'ri-folder-3-line',
  'ri-image-line',
  'ri-video-line',
  'ri-microscope-line',
  'ri-leaf-line',
  'ri-car-line',
  'ri-camera-line',
  'ri-flask-line',
  'ri-database-2-line',
  'ri-shapes-line',
  'ri-bookmark-line',
  'ri-stack-line',
  'ri-chat-3-line',
  'ri-message-3-line',
  'ri-robot-line',
  'ri-quill-pen-line',
] as const;
export type ProjectIcon = (typeof ProjectIcons)[number];

export const ProjectKinds = ['vision', 'llm'] as const;
export type ProjectKind = (typeof ProjectKinds)[number];

export const ProjectKindLabels: Record<ProjectKind, string> = {
  vision: 'Computer Vision',
  llm: 'LLM',
};

export const ProjectRecordSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  name: z.string(),
  color: z.enum([...ProjectColors]).catch('slate'),
  icon: z.enum([...ProjectIcons]).catch('ri-folder-3-line'),
  kind: z.enum([...ProjectKinds]).catch('vision'),
  labels: z.array(z.string()).default([]),
  thumbnail: z.string().default(''),
  last_opened_at: z.string().nullable().optional(),
  created: z.string(),
  updated: z.string(),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const NewProjectInputSchema = z.object({
  name: z.string().min(1).max(256),
  color: z.enum(ProjectColors),
  icon: z.enum(ProjectIcons),
  kind: z.enum(ProjectKinds),
  labels: z.array(z.string()).default([]),
});
export type NewProjectInput = z.infer<typeof NewProjectInputSchema>;

export const UpdateProjectInputSchema = NewProjectInputSchema.partial();
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
