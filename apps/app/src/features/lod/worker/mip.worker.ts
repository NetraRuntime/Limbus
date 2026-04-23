/// <reference lib="webworker" />
import { WEBP_QUALITY } from '../types';
import type { AssetKind } from '../types';

type GenerateMessage = {
  type: 'generate';
  id: number;
  assetId: string;
  kind: AssetKind;
  bitmap: ImageBitmap;
  levels: number[];
};

type CancelMessage = { type: 'cancel'; id: number };
type InMessage = GenerateMessage | CancelMessage;

type LevelMessage = {
  type: 'level';
  id: number;
  assetId: string;
  levelPx: number;
  blob: Blob;
  bytes: number;
};
type DoneMessage = { type: 'done'; id: number; assetId: string };
type ErrorMessage = { type: 'error'; id: number; assetId: string; message: string };
export type OutMessage = LevelMessage | DoneMessage | ErrorMessage;

const self: DedicatedWorkerGlobalScope = globalThis as unknown as DedicatedWorkerGlobalScope;

type Job = GenerateMessage;
const queue: Job[] = [];
const cancelled = new Set<number>();
let running = false;

async function encodeLevel(bitmap: ImageBitmap, levelPx: number): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = levelPx / longest;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('mip.worker: 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
}

async function runJob(job: Job): Promise<void> {
  try {
    for (const levelPx of job.levels) {
      if (cancelled.has(job.id)) break;
      const blob = await encodeLevel(job.bitmap, levelPx);
      const msg: LevelMessage = {
        type: 'level',
        id: job.id,
        assetId: job.assetId,
        levelPx,
        blob,
        bytes: blob.size,
      };
      self.postMessage(msg);
    }
    const done: DoneMessage = { type: 'done', id: job.id, assetId: job.assetId };
    self.postMessage(done);
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      id: job.id,
      assetId: job.assetId,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  } finally {
    job.bitmap.close?.();
    cancelled.delete(job.id);
  }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      if (!cancelled.has(next.id)) {
        await runJob(next);
      } else {
        next.bitmap.close?.();
        cancelled.delete(next.id);
      }
    }
  } finally {
    running = false;
  }
}

self.addEventListener('message', (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === 'generate') {
    queue.push(msg);
    void pump();
  } else if (msg.type === 'cancel') {
    cancelled.add(msg.id);
  }
});
