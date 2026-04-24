/**
 * Paint one at-rest bbox (rect + 4 corner ticks) onto a 2D context.
 * Mirrors `.segment-mask-bbox` CSS in App.css:
 *   - 1px rect stroke at 55% accent alpha, 3px corner radius.
 *   - 6x6 corner tick marks in 1.5px solid accent.
 *
 * Coordinates are in viewport pixels. Caller is responsible for
 * applying devicePixelRatio via `ctx.setTransform` before calling.
 */
export function paintBbox(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  rect: { left: number; top: number; width: number; height: number },
  accent: string,
): void {
  const { left, top, width, height } = rect;
  if (width <= 0 || height <= 0) return;

  ctx.save();
  // Dim rect. `color-mix(srgb, accent 55%, transparent)` is approximated
  // here by globalAlpha; the accent string carries the hue.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  roundRectPath(ctx, left + 0.5, top + 0.5, width - 1, height - 1, 3);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Corner ticks: 6×6 L-shapes at each corner, 1.5px stroke. Drawn as
  // two line segments per corner.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent;
  const tick = 6;
  const t = 0.75; // half of 1.5px stroke → align the inside of the L

  ctx.beginPath();
  ctx.moveTo(left + tick, top + t);
  ctx.lineTo(left + t, top + t);
  ctx.lineTo(left + t, top + tick);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left + width - tick, top + t);
  ctx.lineTo(left + width - t, top + t);
  ctx.lineTo(left + width - t, top + tick);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left + t, top + height - tick);
  ctx.lineTo(left + t, top + height - t);
  ctx.lineTo(left + tick, top + height - t);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left + width - tick, top + height - t);
  ctx.lineTo(left + width - t, top + height - t);
  ctx.lineTo(left + width - t, top + height - tick);
  ctx.stroke();

  ctx.restore();
}

function roundRectPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
