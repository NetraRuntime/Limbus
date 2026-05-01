import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisionCanvas } from './VisionCanvasContext';

describe('useVisionCanvas', () => {
  it('throws when called outside a VisionCanvasProvider', () => {
    expect(() => renderHook(() => useVisionCanvas())).toThrow(
      /useVisionCanvas must be used inside a VisionCanvasProvider/,
    );
  });
});
