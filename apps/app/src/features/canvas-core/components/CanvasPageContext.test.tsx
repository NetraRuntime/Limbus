import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasPage } from './CanvasPageContext';

describe('useCanvasPage', () => {
  it('throws when called outside a CanvasPageProvider', () => {
    expect(() => renderHook(() => useCanvasPage())).toThrow(
      /useCanvasPage must be used inside a CanvasPage/,
    );
  });
});
