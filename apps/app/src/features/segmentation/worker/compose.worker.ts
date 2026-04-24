/// <reference lib="webworker" />
import { composeBake } from '../compose';
import type { ComposedBake } from '../types';

type ComposeJobInput = {
  sourceW: number;
  sourceH: number;
  maxSide?: number;
  masks: ReadonlyArray<{
    tag: string;
    maskIndex: number;
    png_base64: string;
    maskW: number;
    maskH: number;
    bbox: [number, number, number, number] | null;
    accent: string;
  }>;
};

type InMessage = {
  type: 'compose';
  id: number;
  input: ComposeJobInput;
};

type DoneMessage = {
  type: 'done';
  id: number;
  bitmap: ImageBitmap;
  hitMasks: ComposedBake['hitMasks'];
  width: number;
  height: number;
};

type ErrorMessage = {
  type: 'error';
  id: number;
  message: string;
};

export type OutMessage = DoneMessage | ErrorMessage;

const selfRef: DedicatedWorkerGlobalScope =
  globalThis as unknown as DedicatedWorkerGlobalScope;

// Worker-local decode cache. Each worker owns its own ImageBitmap cache
// so the main thread never holds decoded PNGs. Capacity mirrors the
// pre-worker main-thread cache.
const DECODE_CAP = 128;
const decoded = new Map<string, ImageBitmap>();

async function decode(b64: string): Promise<ImageBitmap> {
  const existing = decoded.get(b64);
  if (existing) return existing;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  if (decoded.size >= DECODE_CAP) {
    const oldest = decoded.keys().next().value;
    if (oldest !== undefined) {
      const old = decoded.get(oldest);
      decoded.delete(oldest);
      old?.close?.();
    }
  }
  decoded.set(b64, bmp);
  return bmp;
}

async function run(job: InMessage): Promise<void> {
  try {
    const composed = await composeBake({
      sourceW: job.input.sourceW,
      sourceH: job.input.sourceH,
      maxSide: job.input.maxSide,
      masks: job.input.masks,
      decodeCache: { get: decode },
    });
    const msg: DoneMessage = {
      type: 'done',
      id: job.id,
      bitmap: composed.bitmap,
      hitMasks: composed.hitMasks,
      width: composed.width,
      height: composed.height,
    };
    selfRef.postMessage(msg, [composed.bitmap]);
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      id: job.id,
      message: err instanceof Error ? err.message : String(err),
    };
    selfRef.postMessage(msg);
  }
}

selfRef.addEventListener('message', (e: MessageEvent<InMessage>) => {
  if (e.data.type === 'compose') void run(e.data);
});
