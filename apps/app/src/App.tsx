import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Canvas } from './Canvas';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { focusHome } from './lib/windows';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'no-model' }
  | { status: 'error'; message: string };

type AppProps = {
  projectId: string;
};

type LocalModel = { name: string };

export function App({ projectId }: AppProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const { settings } = useSettings();
  // Apply the persisted theme at the top level so the boot screen matches
  // the user's preference before Canvas mounts. Canvas also calls this hook
  // for reactivity to in-session changes; both calls are idempotent.
  useAppliedTheme(settings.theme);

  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const activeModel = settings.activeModel;

    async function run() {
      try {
        // Confirm the pinned model is actually present on disk — a stale
        // setting (user deleted the file outside the app) shouldn't crash
        // warmup with a confusing missing-file error.
        const installed = await invoke<LocalModel[]>('models_list_local');
        if (cancelled) return;
        const exists =
          activeModel != null && installed.some((m) => m.name === activeModel);
        if (!activeModel || !exists) {
          // Tell the worker explicitly so any earlier override is cleared.
          await invoke('sam3_set_active_model', { name: null });
          if (!cancelled) setBoot({ status: 'no-model' });
          return;
        }
        await invoke('sam3_set_active_model', { name: activeModel });
        await invoke<void>('sam3_warmup');
        if (!cancelled) setBoot({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[sam3] warmup failed', err);
        setBoot({ status: 'error', message });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [settings.activeModel]);

  if (boot.status === 'loading') return <BootScreen />;
  if (boot.status === 'no-model') return <NoModelScreen />;
  return <Canvas projectId={projectId} sam3Error={boot.status === 'error' ? boot.message : null} />;
}

function BootScreen() {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <div className="boot-card">
        <div className="boot-spinner" aria-hidden />
        <div className="boot-title">Loading SAM3 model…</div>
        <div className="boot-subtitle">
          First launch loads the image encoder onto the GPU. This takes a few seconds.
        </div>
      </div>
    </div>
  );
}

function NoModelScreen() {
  return (
    <div className="boot-screen" role="alert">
      <div className="boot-card">
        <div className="boot-title">No model active</div>
        <div className="boot-subtitle">Install one from Home → Models.</div>
        <button
          type="button"
          className="btn btn-md btn-primary"
          onClick={() => void focusHome()}
        >
          Open Home
        </button>
      </div>
    </div>
  );
}
