import { useEffect, useRef, useState } from 'react';
import type { BakeEntry, ComposedBake, ComposeInput } from './types';
import { composeBake as defaultComposeBake } from './compose';
import { computeSignature } from './signature';
import { createDecodeCache } from './decodeCache';
import { createComposeWorker } from './worker/composeWorkerClient';

const DECODE_CAP = 128;
const BAKE_CAP = 32;

// Main-thread decode cache. Only used by the fallback path when the
// worker is unavailable (the worker owns its own cache).
const decodeCache = createDecodeCache<ImageBitmap>({
  capacity: DECODE_CAP,
  decode: async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    return await createImageBitmap(blob);
  },
  closeBitmap: (b) => {
    b.close();
  },
});

// Insertion-order eviction: oldest entry is evicted first. Good enough
// for v1; swap for a full LRU if it becomes a hot path.
const bakeStore = new Map<string, BakeEntry>();

function evictBakeStore() {
  while (bakeStore.size > BAKE_CAP) {
    const oldest = bakeStore.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = bakeStore.get(oldest);
    bakeStore.delete(oldest);
    entry?.bitmap.close();
  }
}

export function evictBake(imageId: string): void {
  const entry = bakeStore.get(imageId);
  if (!entry) return;
  bakeStore.delete(imageId);
  entry.bitmap.close();
}

export function evictDecode(png_base64: string): void {
  decodeCache.drop(png_base64);
}

// Lazily create the worker on first use so tests that don't exercise
// the worker path don't pay for it. If the worker can't be constructed
// (policy-blocked, tests without a Worker, etc.), fall back to the
// direct main-thread compose.
let workerClient: ReturnType<typeof createComposeWorker> = null;
let workerAttempted = false;

function resolveCompose(): (input: ComposeInput) => Promise<ComposedBake> {
  if (!workerAttempted) {
    workerAttempted = true;
    workerClient = createComposeWorker();
  }
  if (workerClient) return workerClient.compose;
  return defaultComposeBake;
}

// Test seam: swap composeBake. When `null`, useSegmentBake picks
// between the worker-backed and main-thread composers via
// `resolveCompose`. Tests typically inject a synchronous fake to keep
// the hook deterministic.
let composeFn: ((input: ComposeInput) => Promise<ComposedBake>) | null = null;

export function __setComposeForTests(
  fn: (input: ComposeInput) => Promise<ComposedBake>,
): void {
  composeFn = fn;
}

export function __resetBakeCacheForTests(): void {
  bakeStore.clear();
  composeFn = null;
  workerClient?.terminate();
  workerClient = null;
  workerAttempted = false;
}

export type BakeHookInput = {
  imageId: string;
  sourceW: number;
  sourceH: number;
  masks: ComposeInput['masks'];
};

/**
 * Returns the current `BakeEntry` for an image, re-running `composeBake`
 * whenever the input signature changes. The entry is cached at module
 * scope, so scroll-out/scroll-back does not re-bake.
 */
export function useSegmentBake(input: BakeHookInput): {
  bake: BakeEntry | null;
} {
  const [bake, setBake] = useState<BakeEntry | null>(() => {
    return bakeStore.get(input.imageId) ?? null;
  });

  const runIdRef = useRef(0);
  const signature = computeSignature(input.masks);
  // Stash the latest input so the effect can read masks without needing
  // them in its dep array (their array ref changes every parent render).
  // `signature` in deps is the content-equivalent stand-in, so the
  // effect only re-runs when the bake actually needs to be invalidated.
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const cached = bakeStore.get(input.imageId);
    if (cached && cached.signature === signature) {
      setBake((prev) => (prev === cached ? prev : cached));
      return;
    }

    const runId = ++runIdRef.current;
    let cancelled = false;

    (async () => {
      const current = inputRef.current;
      const compose = composeFn ?? resolveCompose();
      const composed = await compose({
        sourceW: current.sourceW,
        sourceH: current.sourceH,
        masks: current.masks,
        decodeCache,
      });
      if (cancelled || runId !== runIdRef.current) {
        composed.bitmap.close();
        return;
      }
      const entry: BakeEntry = { ...composed, signature };
      const prior = bakeStore.get(current.imageId);
      bakeStore.set(current.imageId, entry);
      if (prior && prior !== entry) prior.bitmap.close();
      evictBakeStore();
      setBake(entry);
    })();

    return () => {
      cancelled = true;
    };
  }, [input.imageId, input.sourceW, input.sourceH, signature]);

  return { bake };
}
