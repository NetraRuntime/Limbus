export type InstallKind =
  | 'appimage'
  | 'deb'
  | 'macos-app'
  | 'windows'
  | 'dev'
  | 'unknown';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes: string }
  | { status: 'downloading'; version: string; downloadedBytes: number; totalBytes: number | null }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };
