// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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
});
