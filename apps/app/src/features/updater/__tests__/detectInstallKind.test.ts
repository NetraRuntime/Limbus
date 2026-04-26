import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectInstallKind } from '../utils/detectInstallKind';

vi.mock('@tauri-apps/api/path', () => ({
  resourceDir: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { resourceDir } from '@tauri-apps/api/path';

describe('detectInstallKind', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "macos-app" when resource path lives inside an .app bundle', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/Applications/NetraRT.app/Contents/Resources');
    const k = await detectInstallKind('darwin');
    expect(k).toBe('macos-app');
  });

  it('returns "deb" when resource path lives under /usr/lib', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/usr/lib/netrart');
    const k = await detectInstallKind('linux');
    expect(k).toBe('deb');
  });

  it('returns "appimage" when APPIMAGE env variable is reflected by tauri', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/tmp/.mount_NetraRABCDEF/usr/lib/netrart');
    const k = await detectInstallKind('linux');
    expect(k).toBe('appimage');
  });

  it('returns "windows" on win32 platform', async () => {
    vi.mocked(resourceDir).mockResolvedValue('C:\\Program Files\\NetraRT\\resources');
    const k = await detectInstallKind('win32');
    expect(k).toBe('windows');
  });

  it('returns "dev" when path looks like a dev target dir', async () => {
    vi.mocked(resourceDir).mockResolvedValue('/Users/dev/netrart/apps/app/src-tauri/target/debug/resources');
    const k = await detectInstallKind('darwin');
    expect(k).toBe('dev');
  });
});
