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
  // Paint the bake bitmap into the canvas via 2D drawImage. We deliberately
  // do NOT use bitmaprenderer.transferFromImageBitmap: that call is destructive
  // (the bitmap gets neutered on first transfer), so when the layer unmounts
  // on viewport cull / image switch and later remounts, the cached BakeEntry's
  // bitmap can't be transferred a second time and the canvas stays blank —
  // visually indistinguishable from the mask "disappearing" or "degrading".
  // drawImage is idempotent and supports re-painting the same bitmap on every
  // remount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bake) return;
    if (canvas.width !== bake.width) canvas.width = bake.width;
    if (canvas.height !== bake.height) canvas.height = bake.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      ctx.drawImage(bake.bitmap, 0, 0);
    } catch (err) {
      console.warn('[bake] drawImage failed', err);
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
