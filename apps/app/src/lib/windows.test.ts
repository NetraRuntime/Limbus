// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openCanvasWindow, focusHome } from './windows';

describe('windows (web fallback)', () => {
  beforeEach(() => {
    // jsdom defaults to about:blank; reset to a known starting point
    window.history.replaceState({}, '', '/');
  });

  it('openCanvasWindow assigns ?project=<id> on web', () => {
    openCanvasWindow('proj_abc', 'My Project');
    expect(window.location.search).toBe('?project=proj_abc');
  });

  it('focusHome navigates to bare /', () => {
    window.history.replaceState({}, '', '/?project=proj_abc');
    focusHome();
    expect(window.location.search).toBe('');
  });

  it('openCanvasWindow dispatches a popstate event after updating the URL', async () => {
    const handler = vi.fn();
    window.addEventListener('popstate', handler);
    await openCanvasWindow('proj_xyz', 'Test Project');
    expect(window.location.search).toBe('?project=proj_xyz');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', handler);
  });

  it('focusHome dispatches a popstate event after navigating to /', async () => {
    window.history.replaceState({}, '', '/?project=proj_abc');
    const handler = vi.fn();
    window.addEventListener('popstate', handler);
    await focusHome();
    expect(window.location.search).toBe('');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', handler);
  });
});
