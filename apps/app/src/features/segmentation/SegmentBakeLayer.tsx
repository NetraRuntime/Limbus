import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
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
};

export function SegmentBakeLayer({
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
}: SegmentBakeLayerProps) {
  const { bake } = useSegmentBake({ imageId, sourceW, sourceH, masks });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      aria-hidden
    />
  );
}
