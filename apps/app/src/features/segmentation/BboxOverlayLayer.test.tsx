import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { BboxOverlayLayer, type BboxOverlayRect } from './BboxOverlayLayer';

beforeEach(() => {
  // jsdom has no real 2d context; stub with a recording-friendly mock
  // so the effect's setTransform/clearRect/stroke calls don't throw.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    stroke: () => {},
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('BboxOverlayLayer', () => {
  it('renders a fixed-position canvas sized to the viewport', () => {
    const { container } = render(
      <BboxOverlayLayer viewportWidth={800} viewportHeight={600} rects={[]} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.style.position).toBe('fixed');
    expect(canvas!.style.width).toBe('800px');
    expect(canvas!.style.height).toBe('600px');
    expect(canvas!.style.pointerEvents).toBe('none');
  });

  it('is aria-hidden so it does not affect the a11y tree', () => {
    const { container } = render(
      <BboxOverlayLayer viewportWidth={400} viewportHeight={300} rects={[]} />,
    );
    expect(container.querySelector('canvas')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('accepts a list of rects and still mounts', () => {
    const rects: BboxOverlayRect[] = [
      { key: 'a', left: 10, top: 20, width: 100, height: 50, accent: '#f00' },
      { key: 'b', left: 200, top: 30, width: 60, height: 40, accent: '#0f0' },
    ];
    const { container } = render(
      <BboxOverlayLayer viewportWidth={400} viewportHeight={300} rects={rects} />,
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('sizes the backing canvas at devicePixelRatio', () => {
    const prevDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    try {
      const { container } = render(
        <BboxOverlayLayer viewportWidth={400} viewportHeight={300} rects={[]} />,
      );
      const canvas = container.querySelector('canvas')!;
      // CSS size stays in viewport pixels; backing store is 2×.
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      expect(canvas.style.width).toBe('400px');
      expect(canvas.style.height).toBe('300px');
    } finally {
      if (prevDpr) {
        Object.defineProperty(window, 'devicePixelRatio', prevDpr);
      } else {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          value: 1,
        });
      }
    }
  });
});
