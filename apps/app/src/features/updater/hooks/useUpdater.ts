import { useCallback, useEffect, useRef, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { detectInstallKind } from '../utils/detectInstallKind';
import type { InstallKind, UpdateState } from '../types';

const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

const CAN_AUTO_UPDATE: ReadonlySet<InstallKind> = new Set([
  'macos-app',
  'windows',
  'appimage',
]);

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [installKind, setInstallKind] = useState<InstallKind | null>(null);
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  // Detect install kind once.
  useEffect(() => {
    let cancelled = false;
    detectInstallKind(
      typeof navigator !== 'undefined'
        ? navigator.userAgent.includes('Mac')
          ? 'darwin'
          : navigator.userAgent.includes('Windows')
            ? 'win32'
            : 'linux'
        : 'unknown',
    ).then((k) => {
      if (!cancelled) setInstallKind(k);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const performCheck = useCallback(async () => {
    if (!installKind || !CAN_AUTO_UPDATE.has(installKind)) return;
    setState({ status: 'checking' });
    try {
      const update = await withTimeout(check(), CHECK_TIMEOUT_MS);
      if (update?.available) {
        updateRef.current = update;
        setState({
          status: 'available',
          version: update.version,
          notes: update.body ?? '',
        });
      } else {
        setState({ status: 'idle' });
      }
    } catch (e) {
      // Silent on failure per spec — don't stay in error state forever.
      setState({ status: 'idle' });
      console.warn('[updater] check failed:', (e as Error).message);
    }
  }, [installKind]);

  // Initial check + 24h interval.
  useEffect(() => {
    if (!installKind) return;
    void performCheck();
    const id = setInterval(() => void performCheck(), RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [installKind, performCheck]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState({
      status: 'downloading',
      version: update.version,
      downloadedBytes: 0,
      totalBytes: null,
    });
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          setState({
            status: 'downloading',
            version: update.version,
            downloadedBytes: downloaded,
            totalBytes: total,
          });
        }
      });
      setState({ status: 'ready', version: update.version });
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
      console.warn('[updater] install failed:', (e as Error).message);
    }
  }, []);

  const restartNow = useCallback(async () => {
    await relaunch();
  }, []);

  return {
    state,
    installKind,
    downloadAndInstall,
    restartNow,
  };
}
