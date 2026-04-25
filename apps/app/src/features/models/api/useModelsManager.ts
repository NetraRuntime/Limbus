import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const PROGRESS_EVENT = 'model-download-progress';

export type RemoteModel = {
  name: string;
  size: number;
  url: string;
};

export type LocalModel = {
  name: string;
  size: number;
  path: string;
};

export type ProgressPayload =
  | { phase: 'started'; name: string; total: number }
  | { phase: 'progress'; name: string; downloaded: number; total: number }
  | { phase: 'done'; name: string; total: number }
  | { phase: 'cancelled'; name: string }
  | { phase: 'error'; name: string; message: string };

export type RowStatus =
  | { kind: 'available' }
  | { kind: 'installed' }
  | { kind: 'downloading'; downloaded: number; total: number }
  | { kind: 'error'; message: string };

export type ModelRow = {
  name: string;
  size: number;
  url: string | null;
  installed: boolean;
  active: boolean;
  status: RowStatus;
};

export type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

type Args = {
  activeModel: string | null;
  onSetActiveModel: (name: string | null) => void;
  onDownloadFinished?: (name: string) => void;
};

/**
 * Central manager for the SAM3 model catalog. Owns:
 *
 * - the remote/local listings (refetched on mount, after every download
 *   completion, and on focus so a sidecar download surface stays fresh),
 * - the in-flight progress map keyed by filename,
 * - the action callbacks (download / cancel / delete / use).
 *
 * Multiple components can each call this hook — they keep state
 * independently but converge through the shared `model-download-progress`
 * Tauri event broadcast and the persisted `activeModel` setting.
 */
export function useModelsManager({
  activeModel,
  onSetActiveModel,
  onDownloadFinished,
}: Args) {
  const [remote, setRemote] = useState<RemoteModel[]>([]);
  const [local, setLocal] = useState<LocalModel[]>([]);
  const [progress, setProgress] = useState<Record<string, RowStatus>>({});
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });

  // Latest activeModel without retriggering effects — handlers read it.
  const activeRef = useRef(activeModel);
  activeRef.current = activeModel;
  const finishedRef = useRef(onDownloadFinished);
  finishedRef.current = onDownloadFinished;

  const refreshLocal = useCallback(async () => {
    if (!isTauri) return;
    try {
      const l = await invoke<LocalModel[]>('models_list_local');
      setLocal(l);
    } catch (err) {
      console.warn('[models] failed to refresh local list', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    async function init() {
      setLoadState({ phase: 'loading' });
      try {
        if (!isTauri) {
          if (!cancelled) {
            setLoadState({
              phase: 'error',
              message: 'Model management is only available in the desktop app.',
            });
          }
          return;
        }
        const [r, l] = await Promise.all([
          invoke<RemoteModel[]>('models_list_remote'),
          invoke<LocalModel[]>('models_list_local'),
        ]);
        if (cancelled) return;
        setRemote(r);
        setLocal(l);
        setLoadState({ phase: 'ready' });

        unlisten = await listen<ProgressPayload>(PROGRESS_EVENT, (event) => {
          handleProgress(event.payload);
        });
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoadState({ phase: 'error', message });
      }
    }

    function handleProgress(payload: ProgressPayload) {
      setProgress((prev) => {
        const next = { ...prev };
        if (payload.phase === 'started') {
          next[payload.name] = {
            kind: 'downloading',
            downloaded: 0,
            total: payload.total,
          };
        } else if (payload.phase === 'progress') {
          next[payload.name] = {
            kind: 'downloading',
            downloaded: payload.downloaded,
            total: payload.total,
          };
        } else if (payload.phase === 'done') {
          delete next[payload.name];
          void refreshLocal();
          finishedRef.current?.(payload.name);
        } else if (payload.phase === 'cancelled') {
          delete next[payload.name];
        } else if (payload.phase === 'error') {
          next[payload.name] = { kind: 'error', message: payload.message };
        }
        return next;
      });
    }

    void init();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshLocal]);

  const rows = useMemo<ModelRow[]>(() => {
    const localByName = new Map(local.map((m) => [m.name, m] as const));
    const seen = new Set<string>();
    const merged: ModelRow[] = [];

    for (const r of remote) {
      seen.add(r.name);
      const localHit = localByName.get(r.name);
      const live = progress[r.name];
      const status: RowStatus = live ?? (localHit ? { kind: 'installed' } : { kind: 'available' });
      merged.push({
        name: r.name,
        size: localHit?.size ?? r.size,
        url: r.url,
        installed: Boolean(localHit),
        active: Boolean(localHit) && r.name === activeModel,
        status,
      });
    }
    for (const l of local) {
      if (seen.has(l.name)) continue;
      const live = progress[l.name];
      merged.push({
        name: l.name,
        size: l.size,
        url: null,
        installed: true,
        active: l.name === activeModel,
        status: live ?? { kind: 'installed' },
      });
    }
    return merged;
  }, [remote, local, progress, activeModel]);

  const inFlight = useMemo(() => {
    const out: Array<{ name: string; downloaded: number; total: number }> = [];
    for (const [name, s] of Object.entries(progress)) {
      if (s.kind === 'downloading') {
        out.push({ name, downloaded: s.downloaded, total: s.total });
      }
    }
    return out;
  }, [progress]);

  const installedCount = local.length;

  const download = useCallback(async (row: ModelRow) => {
    if (!row.url || !isTauri) return;
    setProgress((p) => ({
      ...p,
      [row.name]: { kind: 'downloading', downloaded: 0, total: row.size },
    }));
    try {
      await invoke('models_download', { name: row.name, url: row.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProgress((p) => ({ ...p, [row.name]: { kind: 'error', message } }));
    }
  }, []);

  const cancel = useCallback(async (name: string) => {
    if (!isTauri) return;
    try {
      await invoke('models_cancel_download', { name });
    } catch (err) {
      console.warn('[models] cancel failed', err);
    }
  }, []);

  const remove = useCallback(
    async (name: string) => {
      if (!isTauri) return;
      try {
        await invoke('models_delete', { name });
        setLocal((prev) => prev.filter((m) => m.name !== name));
        setProgress((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
        if (name === activeRef.current) {
          onSetActiveModel(null);
          try {
            await invoke('sam3_set_active_model', { name: null });
          } catch (err) {
            console.warn('[models] failed to clear active model on delete', err);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProgress((prev) => ({ ...prev, [name]: { kind: 'error', message } }));
      }
    },
    [onSetActiveModel],
  );

  const use = useCallback(
    async (name: string) => {
      if (!isTauri) return;
      onSetActiveModel(name);
      try {
        await invoke('sam3_set_active_model', { name });
      } catch (err) {
        console.warn('[models] failed to set active model', err);
      }
    },
    [onSetActiveModel],
  );

  // Auto-promote first installed model when nothing is pinned. Mirrors
  // Unity Hub's "single installed version is automatically the default".
  useEffect(() => {
    if (activeModel != null) return;
    const first = local[0]?.name;
    if (!first) return;
    void use(first);
  }, [local, activeModel, use]);

  return {
    rows,
    loadState,
    inFlight,
    installedCount,
    download,
    cancel,
    remove,
    use,
  };
}
