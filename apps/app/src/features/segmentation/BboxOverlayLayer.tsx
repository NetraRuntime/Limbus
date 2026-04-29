import { memo, useEffect, useRef } from 'react';
import { paintBbox } from './paintBbox';

export type BboxOverlayRect = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  accent: string;
};

export type BboxOverlayLayerProps = {
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /** Viewport height in CSS pixels. */
  viewportHeight: number;
  /** At-rest bboxes only; selected/hovered remain DOM for interactivity. */
  rects: ReadonlyArray<BboxOverlayRect>;
};

function BboxOverlayLayerImpl({
  viewportWidth,
  viewportHeight,
  rects,
}: BboxOverlayLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(viewportWidth * dpr));
    const pxH = Math.max(1, Math.round(viewportHeight * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    for (const r of rects) {
      paintBbox(
        ctx,
        { left: r.left, top: r.top, width: r.width, height: r.height },
        r.accent,
      );
    }
  }, [viewportWidth, viewportHeight, rects]);

  return (
    <canvas
      ref={canvasRef}
      className="segment-bbox-overlay"
      aria-hidden
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: viewportWidth,
        height: viewportHeight,
        pointerEvents: 'none',
        // Matches .segment-mask-bbox z-index so selected/hovered DOM chrome stacks above.
        zIndex: 12,
      }}
    />
  );
}

export const BboxOverlayLayer = memo(BboxOverlayLayerImpl);
