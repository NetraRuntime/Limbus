import { describe, it, expect } from 'vitest';
import { paintBbox } from './paintBbox';

type Call = { method: string; args: unknown[] };

function mockCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const ctx = {
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    stroke: rec('stroke'),
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('paintBbox', () => {
  it('draws nothing for a zero-width rect', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 0, top: 0, width: 0, height: 10 }, '#ff0000');
    expect(calls.some((c) => c.method === 'stroke')).toBe(false);
  });

  it('draws nothing for a zero-height rect', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 0, top: 0, width: 10, height: 0 }, '#ff0000');
    expect(calls.some((c) => c.method === 'stroke')).toBe(false);
  });

  it('strokes the outer rect plus 4 corner ticks', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 10, top: 20, width: 100, height: 50 }, '#ff0000');
    // 1 rect stroke + 4 corner-tick strokes = 5 calls to stroke().
    const strokeCount = calls.filter((c) => c.method === 'stroke').length;
    expect(strokeCount).toBe(5);
  });

  it('save/restore wrap the paint to avoid leaking state', () => {
    const { ctx, calls } = mockCtx();
    paintBbox(ctx, { left: 0, top: 0, width: 20, height: 20 }, '#ff0000');
    expect(calls[0]!.method).toBe('save');
    expect(calls[calls.length - 1]!.method).toBe('restore');
  });
});
