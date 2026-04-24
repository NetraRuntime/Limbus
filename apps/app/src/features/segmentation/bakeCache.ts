import { useEffect, useRef, useState } from 'react';
import type { BakeEntry, ComposedBake, ComposeInput } from './types';
import { composeBake as defaultComposeBake } from './compose';
import { computeSignature } from './signature';
import { createDecodeCache } from './decodeCache';

const DECODE_CAP = 128;
const BAKE_CAP = 32;

// Module-level caches — survive component remounts (e.g., when an image
// scrolls out of view and back).
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

// Test seam: swap composeBake. Default is the real one.
let composeFn: (input: ComposeInput) => Promise<ComposedBake> = defaultComposeBake;
export function __setComposeForTests(
  fn: (input: ComposeInput) => Promise<ComposedBake>,
): void {
  composeFn = fn;
}

export function __resetBakeCacheForTests(): void {
  bakeStore.clear();
  composeFn = defaultComposeBake;
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
      const composed = await composeFn({
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
