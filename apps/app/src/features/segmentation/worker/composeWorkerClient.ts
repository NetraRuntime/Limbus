import type { ComposedBake, ComposeInput } from '../types';
import type { OutMessage } from './compose.worker';

export type ComposeFn = (input: ComposeInput) => Promise<ComposedBake>;

/** Worker path ignores `input.decodeCache` (worker owns its own); fallback path still needs it. */
export function createComposeWorker(): {
  compose: ComposeFn;
  terminate: () => void;
} | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./compose.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    console.warn(
      '[segmentation] compose worker unavailable; falling back to main thread',
      err,
    );
    return null;
  }

  let nextId = 1;
  const resolvers = new Map<number, (bake: ComposedBake) => void>();
  const rejecters = new Map<number, (err: Error) => void>();

  worker.addEventListener('message', (e: MessageEvent<OutMessage>) => {
    const msg = e.data;
    if (msg.type === 'done') {
      const resolve = resolvers.get(msg.id);
      resolvers.delete(msg.id);
      rejecters.delete(msg.id);
      resolve?.({
        bitmap: msg.bitmap,
        hitMasks: msg.hitMasks,
        width: msg.width,
        height: msg.height,
      });
    } else if (msg.type === 'error') {
      const reject = rejecters.get(msg.id);
      resolvers.delete(msg.id);
      rejecters.delete(msg.id);
      reject?.(new Error(msg.message));
    }
  });

  worker.addEventListener('error', (e) => {
    const err = new Error(e.message || 'compose worker error');
    for (const [id, reject] of rejecters) {
      reject(err);
      resolvers.delete(id);
    }
    rejecters.clear();
  });

  return {
    compose(input) {
      return new Promise<ComposedBake>((resolve, reject) => {
        const id = nextId++;
        resolvers.set(id, resolve);
        rejecters.set(id, reject);
        worker.postMessage({
          type: 'compose',
          id,
          input: {
            sourceW: input.sourceW,
            sourceH: input.sourceH,
            maxSide: input.maxSide,
            masks: input.masks,
          },
        });
      });
    },
    terminate() {
      worker.terminate();
    },
  };
}
