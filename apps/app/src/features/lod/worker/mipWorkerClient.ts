import type { AssetKind } from '../types';
import type { OutMessage } from './mip.worker';

export type WorkerLevelEvent = {
  assetId: string;
  levelPx: number;
  blob: Blob;
  bytes: number;
};

export type GenerateHandle = {
  /** Resolves when the worker finishes emitting all levels (or errors). */
  done: Promise<void>;
  /** Fires per level as it's encoded. */
  onLevel: (cb: (e: WorkerLevelEvent) => void) => void;
  /** Request cancellation; worker stops after the current level. */
  cancel: () => void;
};

export type MipWorkerClient = {
  generate: (args: {
    assetId: string;
    kind: AssetKind;
    bitmap: ImageBitmap;
    levels: number[];
  }) => GenerateHandle;
  terminate: () => void;
};

/** Creates the main-thread proxy for `mip.worker.ts`. Returns null if
 *  workers are unavailable (e.g. policy-blocked environments).
 */
export function createMipWorkerClient(): MipWorkerClient | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./mip.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.warn('[lod] worker unavailable; LoD disabled', err);
    return null;
  }

  let nextId = 1;
  const levelListeners = new Map<number, (e: WorkerLevelEvent) => void>();
  const doneResolvers = new Map<number, () => void>();
  const doneRejecters = new Map<number, (err: Error) => void>();

  worker.addEventListener('message', (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    if (msg.type === 'level') {
      levelListeners.get(msg.id)?.({
        assetId: msg.assetId,
        levelPx: msg.levelPx,
        blob: msg.blob,
        bytes: msg.bytes,
      });
    } else if (msg.type === 'done') {
      doneResolvers.get(msg.id)?.();
      doneResolvers.delete(msg.id);
      doneRejecters.delete(msg.id);
      levelListeners.delete(msg.id);
    } else if (msg.type === 'error') {
      doneRejecters.get(msg.id)?.(new Error(msg.message));
      doneResolvers.delete(msg.id);
      doneRejecters.delete(msg.id);
      levelListeners.delete(msg.id);
    }
  });

  return {
    generate({ assetId, kind, bitmap, levels }) {
      const id = nextId++;
      const done = new Promise<void>((resolve, reject) => {
        doneResolvers.set(id, resolve);
        doneRejecters.set(id, reject);
      });
      worker.postMessage(
        { type: 'generate', id, assetId, kind, bitmap, levels },
        [bitmap],
      );
      return {
        done,
        onLevel(cb) {
          levelListeners.set(id, cb);
        },
        cancel() {
          worker.postMessage({ type: 'cancel', id });
        },
      };
    },
    terminate() {
      worker.terminate();
    },
  };
}
