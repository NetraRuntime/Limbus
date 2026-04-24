import {
  memo,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSegmentBake, type BakeHookInput } from './bakeCache';
import { hitTestAtPointer } from './hitTest';
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
  // De-dupe hover transitions so onMaskHover fires only when the hit changes,
  // not on every pointermove sample.
  const lastHoverIdRef = useRef<number>(0);

  // Publish the latest bitmap into the canvas (zero-copy).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bake) return;
    if (canvas.width !== bake.width) canvas.width = bake.width;
    if (canvas.height !== bake.height) canvas.height = bake.height;
    const ctx = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
    if (!ctx) return;
    ctx.transferFromImageBitmap(bake.bitmap);
  }, [bake]);

  if (!bake) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      onEmptyPointerDown(e);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const id = hitTestAtPointer(
      { pointerX: e.clientX, pointerY: e.clientY },
      rect,
      bake.idMap,
      bake.width,
      bake.height,
    );
    if (id === 0) {
      onEmptyPointerDown(e);
      return;
    }
    e.stopPropagation();
    const m = bake.idToMask[id - 1];
    if (!m) {
      onEmptyPointerDown(e);
      return;
    }
    onMaskSelect({ imageId, tag: m.tag, maskIndex: m.maskIndex });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && onMaskHover) {
      const rect = canvas.getBoundingClientRect();
      const id = hitTestAtPointer(
        { pointerX: e.clientX, pointerY: e.clientY },
        rect,
        bake.idMap,
        bake.width,
        bake.height,
      );
      if (id !== lastHoverIdRef.current) {
        lastHoverIdRef.current = id;
        if (id === 0) {
          onMaskHover(null);
        } else {
          const m = bake.idToMask[id - 1];
          onMaskHover(m ? { imageId, tag: m.tag, maskIndex: m.maskIndex } : null);
        }
      }
    }
    onPointerMove?.(e);
  };

  const handleMouseLeave = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (lastHoverIdRef.current !== 0 && onMaskHover) {
      lastHoverIdRef.current = 0;
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
