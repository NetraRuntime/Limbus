import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SegmentBakeLayer, type SegmentBakeLayerProps } from './SegmentBakeLayer';
import * as bakeCache from './bakeCache';
import type { BakeEntry } from './types';

const mkBake = (overrides: Partial<BakeEntry> = {}): BakeEntry => ({
  signature: 'sig',
  bitmap: { width: 2, height: 2, close: () => {} } as unknown as ImageBitmap,
  // One mask covering the top-left bake pixel region (0,0)..(1,1).
  hitMasks: [
    {
      tag: 'cat',
      maskIndex: 0,
      rings: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      ],
      bbox: { x: 0, y: 0, w: 1, h: 1 },
    },
  ],
  width: 2,
  height: 2,
  ...overrides,
});

const mkProps = (overrides: Partial<SegmentBakeLayerProps> = {}): SegmentBakeLayerProps => ({
  imageId: 'img1',
  worldX: 100,
  worldY: 200,
  worldWidth: 400,
  worldHeight: 400,
  sourceW: 400,
  sourceH: 400,
  masks: [
    {
      tag: 'cat',
      maskIndex: 0,
      png_base64: 'AAAA',
      maskW: 400,
      maskH: 400,
      bbox: null,
      accent: '#ff0000',
    },
  ],
  onMaskSelect: vi.fn(),
  onEmptyPointerDown: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  // Return a stable fake bake synchronously via the hook shim.
  vi.spyOn(bakeCache, 'useSegmentBake').mockReturnValue({ bake: mkBake() });
  // jsdom's CanvasRenderingContext2D doesn't implement the drawing methods
  // the bake-paint effect calls. Stub a 2d-shaped context with the handful we
  // touch so the effect doesn't throw mid-render.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({
      clearRect: () => {},
      drawImage: () => {},
      transferFromImageBitmap: () => {},
    }),
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('SegmentBakeLayer', () => {
  it('renders a canvas at the image world rect', () => {
    const { container } = render(<SegmentBakeLayer {...mkProps()} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.style.left).toBe('100px');
    expect(canvas!.style.top).toBe('200px');
    expect(canvas!.style.width).toBe('400px');
    expect(canvas!.style.height).toBe('400px');
    // Intrinsic bake dims flow to the canvas attrs.
    expect(canvas!.width).toBe(2);
    expect(canvas!.height).toBe(2);
  });

  it('calls onMaskSelect on pointerdown over a mask pixel', () => {
    const onMaskSelect = vi.fn();
    const onEmptyPointerDown = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskSelect, onEmptyPointerDown })} />,
    );
    const canvas = container.querySelector('canvas')!;
    // Stub getBoundingClientRect to align with worldX/Y/size (jsdom returns 0s).
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    // Pointer near top-left → image-local (1,1) → bake pixel (0,0) → id 1.
    fireEvent.pointerDown(canvas, { clientX: 101, clientY: 201 });
    expect(onMaskSelect).toHaveBeenCalledWith({
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
    });
    expect(onEmptyPointerDown).not.toHaveBeenCalled();
  });

  it('forwards to onEmptyPointerDown when pointer hits an empty pixel', () => {
    const onMaskSelect = vi.fn();
    const onEmptyPointerDown = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskSelect, onEmptyPointerDown })} />,
    );
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    // Pointer near bottom-right → outside the mask's bake-space bbox (0..1, 0..1) → null hit.
    fireEvent.pointerDown(canvas, { clientX: 499, clientY: 599 });
    expect(onMaskSelect).not.toHaveBeenCalled();
    expect(onEmptyPointerDown).toHaveBeenCalled();
  });

  it('fires onMaskHover on transitions and forwards the pointermove', () => {
    const onMaskHover = vi.fn();
    const onPointerMove = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskHover, onPointerMove })} />,
    );
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    // Over mask id 1 (top-left bake pixel).
    fireEvent.pointerMove(canvas, { clientX: 101, clientY: 201 });
    // Second sample still on id 1 — should NOT re-fire (de-duped).
    fireEvent.pointerMove(canvas, { clientX: 105, clientY: 205 });
    // Off the mask entirely → clears to null.
    fireEvent.pointerMove(canvas, { clientX: 499, clientY: 599 });
    expect(onMaskHover).toHaveBeenNthCalledWith(1, {
      imageId: 'img1',
      tag: 'cat',
      maskIndex: 0,
    });
    expect(onMaskHover).toHaveBeenNthCalledWith(2, null);
    expect(onMaskHover).toHaveBeenCalledTimes(2);
    // The forwarded onPointerMove still runs for every sample.
    expect(onPointerMove).toHaveBeenCalledTimes(3);
  });

  it('fires onMaskHover(null) on mouseleave when a mask was hovered', () => {
    const onMaskHover = vi.fn();
    const onMouseLeave = vi.fn();
    const { container } = render(
      <SegmentBakeLayer {...mkProps({ onMaskHover, onMouseLeave })} />,
    );
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 200, right: 500, bottom: 600, width: 400, height: 400, x: 100, y: 200, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(canvas, { clientX: 101, clientY: 201 });
    fireEvent.mouseLeave(canvas);
    expect(onMaskHover).toHaveBeenLastCalledWith(null);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  // The canvas sits over the <img> with pointer-events: auto. Without these
  // pass-throughs, hovering the image body is swallowed by the canvas and the
  // image's hover highlight never fires.
  it('forwards hover and drag events to the image handlers', () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    const { container } = render(
      <SegmentBakeLayer
        {...mkProps({
          onMouseEnter,
          onMouseLeave,
          onPointerMove,
          onPointerUp,
        })}
      />,
    );
    const canvas = container.querySelector('canvas')!;
    fireEvent.mouseEnter(canvas);
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 250 });
    fireEvent.pointerUp(canvas, { clientX: 150, clientY: 250 });
    fireEvent.mouseLeave(canvas);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });
});
