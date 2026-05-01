import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLlmCanvas } from './LlmCanvasContext';

describe('useLlmCanvas', () => {
  it('throws when called outside an LlmCanvasProvider', () => {
    expect(() => renderHook(() => useLlmCanvas())).toThrow(
      /useLlmCanvas must be used inside an LlmCanvasProvider/,
    );
  });
});
