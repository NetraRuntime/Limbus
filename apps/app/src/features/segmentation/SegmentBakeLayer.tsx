import {
  memo,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSegmentBake, type BakeHookInput } from './bakeCache';
import { hitTestAtPointer } from './hitTestMask';
import type { MaskIdentity } from './types';

export type SegmentBakeLayerProps = {
  imageId: string;
  // World-coord placement (lives inside .ic-content alongside the <img>).
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
  // Bake input.
  sourceW: number;
  sourceH: number;
  masks: BakeHookInput['masks'];
  // Pointer routing.
  onMaskSelect: (mask: MaskIdentity) => void;
  onEmptyPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  // Fires as the pointer moves across the bake: the hit-tested mask, or null
  // when over empty pixels or after the cursor leaves the layer. De-duped:
  // only fires on transitions, not every pointermove.
  onMaskHover?: (mask: MaskIdentity | null) => void;
  // The overlay sits over the image with pointer-events: auto, so it absorbs
  // hover/drag events that would otherwise reach the <img>. Forward them so
  // the image's hover highlight and in-progress drags work on the image body.
  onMouseEnter?: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave?: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
};

function SegmentBakeLayerImpl({
  imageId,
  worldX,
  worldY,
  worldWidth,
  worldHeight,
  sourceW,
  sourceH,
  masks,
  onMaskSelect,
  onEmptyPointerDown,
  onMaskHover,
  onMouseEnter,
  onMouseLeave,
  onPointerMove,
  onPointerUp,
}: SegmentBakeLayerProps) {
  const { bake } = useSegmentBake({ imageId, sourceW, sourceH, masks });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Track the last mask under the pointer by stable identity string so
  // onMaskHover only fires on transitions, not every pointermove sample.
  const lastHoverKeyRef = useRef<string | null>(null);
  // `transferFromImageBitmap` is DESTRUCTIVE — after the first call the
  // bitmap is neutered and subsequent calls throw `InvalidStateError`.
  // React StrictMode double-invokes effects in dev, so guard the second
  // invocation by remembering the last bitmap we successfully consumed.
  // (Ref persists across StrictMode's simulated unmount → remount.)
  const consumedBitmapRef = useRef<ImageBitmap | null>(null);

  // Publish the latest bitmap into the canvas (zero-copy).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bake) return;
    if (consumedBitmapRef.current === bake.bitmap) return;
    if (canvas.width !== bake.width) canvas.width = bake.width;
    if (canvas.height !== bake.height) canvas.height = bake.height;
    const ctx = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
    if (!ctx) return;
    try {
      ctx.transferFromImageBitmap(bake.bitmap);
      consumedBitmapRef.current = bake.bitmap;
    } catch (err) {
      // Defensive: if the bitmap was already consumed by another canvas
      // (bake cache sharing, hot-reload edge cases), swallow the throw so
      // the whole tree doesn't unmount — the canvas just stays blank.
      console.warn('[bake] transferFromImageBitmap failed', err);
    }
  }, [bake]);

  if (!bake) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      onEmptyPointerDown(e);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = hitTestAtPointer(
      { pointerX: e.clientX, pointerY: e.clientY },
      rect,
      bake.hitMasks,
      imageId,
      bake.width,
      bake.height,
    );
    if (!hit) {
      onEmptyPointerDown(e);
      return;
    }
    e.stopPropagation();
    onMaskSelect(hit);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && onMaskHover) {
      const rect = canvas.getBoundingClientRect();
      const hit = hitTestAtPointer(
        { pointerX: e.clientX, pointerY: e.clientY },
        rect,
        bake.hitMasks,
        imageId,
        bake.width,
        bake.height,
      );
      const key = hit ? `${hit.tag}:${hit.maskIndex}` : null;
      if (key !== lastHoverKeyRef.current) {
        lastHoverKeyRef.current = key;
        onMaskHover(hit);
      }
    }
    onPointerMove?.(e);
  };

  const handleMouseLeave = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (lastHoverKeyRef.current !== null && onMaskHover) {
      lastHoverKeyRef.current = null;
      onMaskHover(null);
    }
    onMouseLeave?.(e);
  };

  return (
    <canvas
      ref={canvasRef}
      className="segment-bake"
      width={bake.width}
      height={bake.height}
      style={{
        position: 'absolute',
        left: worldX,
        top: worldY,
        width: worldWidth,
        height: worldHeight,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-hidden
    />
  );
}

export const SegmentBakeLayer = memo(SegmentBakeLayerImpl);
