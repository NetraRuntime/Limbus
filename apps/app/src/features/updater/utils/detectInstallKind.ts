import { resourceDir } from '@tauri-apps/api/path';
import type { InstallKind } from '../types';

export async function detectInstallKind(platform: string): Promise<InstallKind> {
  let dir: string;
  try {
    dir = await resourceDir();
  } catch {
    return 'unknown';
  }

  // Dev runs always come from the cargo target dir.
  if (dir.includes('/src-tauri/target/') || dir.includes('\\src-tauri\\target\\')) {
    return 'dev';
  }

  if (platform === 'darwin') {
    if (dir.includes('.app/Contents/')) return 'macos-app';
    return 'unknown';
  }

  if (platform === 'win32') {
    return 'windows';
  }

  if (platform === 'linux') {
    // AppImage mounts under /tmp/.mount_<random> at runtime.
    if (dir.startsWith('/tmp/.mount_')) return 'appimage';
    // .deb places resources under /usr/lib/netra-limbus.
    if (dir.startsWith('/usr/lib/') || dir.startsWith('/usr/share/')) return 'deb';
    return 'unknown';
  }

  return 'unknown';
}
