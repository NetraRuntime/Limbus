import { z } from 'zod';
import { STACK_ORDER_STORAGE_KEY } from './constants';

const StoredStackOrderSchema = z.array(z.string());

export const readStoredStackOrder = (): string[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STACK_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = StoredStackOrderSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

export const writeStoredStackOrder = (order: string[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STACK_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* quota or disabled storage — best-effort persistence */
  }
};
