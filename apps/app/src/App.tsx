import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Canvas } from './Canvas';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { focusHome } from './lib/windows';
import { getProject } from './features/projects/api/projects';
import type { ProjectKind } from './features/projects/types/project';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'no-model' }
  | { status: 'error'; message: string };

type ProjectKindState =
  | { status: 'loading' }
  | { status: 'ready'; kind: ProjectKind }
  | { status: 'error'; message: string };

type AppProps = {
  projectId: string;
};

type LocalModel = { name: string };

export function App({ projectId }: AppProps) {
  const [kindState, setKindState] = useState<ProjectKindState>({ status: 'loading' });
  const { settings } = useSettings();
  useAppliedTheme(settings.theme);

  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((p) => {
        if (!cancelled) setKindState({ status: 'ready', kind: p.kind });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setKindState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (kindState.status === 'loading') return <BootScreen />;
  if (kindState.status === 'error') {
    return <ErrorScreen message={kindState.message} />;
  }
  if (kindState.kind === 'llm') {
    return <Canvas projectId={projectId} kind="llm" />;
  }
  return <VisionApp projectId={projectId} settingsModel={settings.activeModel} />;
}

type VisionAppProps = {
  projectId: string;
  settingsModel: string | null | undefined;
};

function VisionApp({ projectId, settingsModel }: VisionAppProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const activeModel = settingsModel;

    async function run() {
      try {
        const installed = await invoke<LocalModel[]>('models_list_local');
        if (cancelled) return;
        const exists =
          activeModel != null && installed.some((m) => m.name === activeModel);
        if (!activeModel || !exists) {
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
  }, [settingsModel]);

  if (boot.status === 'loading') return <BootScreen />;
  if (boot.status === 'no-model') return <NoModelScreen />;
  return <Canvas projectId={projectId} kind="vision" />;
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

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="boot-screen" role="alert">
      <div className="boot-card">
        <div className="boot-title">Couldn't open project</div>
        <div className="boot-subtitle">{message}</div>
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
