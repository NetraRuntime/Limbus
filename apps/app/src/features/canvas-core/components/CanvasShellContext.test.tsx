import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCanvasShell } from './CanvasShellContext';

describe('useCanvasShell', () => {
  it('throws when called outside a CanvasShellProvider', () => {
    expect(() => renderHook(() => useCanvasShell())).toThrow(
      /useCanvasShell must be used inside a CanvasShell/,
    );
  });
});
