import PocketBase from 'pocketbase';
import { z } from 'zod';

const EnvSchema = z.object({
  VITE_PB_URL: z.string().optional(),
});
const env = EnvSchema.parse(import.meta.env);

const rawUrl = env.VITE_PB_URL ?? '';
export const PB_URL = rawUrl.replace(/\/+$/, '');

// new PocketBase('') rejects empty — pass '/' so it issues relative paths.
export const pb = new PocketBase(PB_URL || '/');

pb.autoCancellation(false);
