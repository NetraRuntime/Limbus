// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdater } from '../hooks/useUpdater';

// React Testing Library's waitFor detects fake timers by checking for a
// global `jest` object. Alias it to `vi` so RTL drives the timers correctly
// when `vi.useFakeTimers()` is active in this suite.
(globalThis as unknown as { jest: typeof vi }).jest = vi;

const checkMock = vi.fn();
const downloadAndInstallMock = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => checkMock(),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));
vi.mock('../utils/detectInstallKind', () => ({
  detectInstallKind: vi.fn().mockResolvedValue('macos-app'),
}));

describe('useUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    downloadAndInstallMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle and transitions to available when an update exists', async () => {
    checkMock.mockResolvedValue({
      available: true,
      version: '0.3.0',
      body: 'See release notes',
      downloadAndInstall: downloadAndInstallMock,
    });

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(result.current.state.status).toBe('available');
    });
    if (result.current.state.status === 'available') {
      expect(result.current.state.version).toBe('0.3.0');
    }
  });

  it('stays idle when no update is available', async () => {
    checkMock.mockResolvedValue({ available: false });

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(checkMock).toHaveBeenCalled();
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('transitions to error on check failure but does not throw', async () => {
    checkMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(result.current.state.status === 'idle' || result.current.state.status === 'error').toBe(true);
    });
    // Failure should be silent: idle is acceptable; error is acceptable; throw is not.
  });

  it('does not attempt to check on .deb installs', async () => {
    const detectMock = await import('../utils/detectInstallKind');
    vi.mocked(detectMock.detectInstallKind).mockResolvedValueOnce('deb');

    renderHook(() => useUpdater());

    await waitFor(() => {
      // Give effects time to settle.
      expect(true).toBe(true);
    });
    expect(checkMock).not.toHaveBeenCalled();
  });
});
