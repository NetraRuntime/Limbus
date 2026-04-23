import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Canvas } from './Canvas';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export function App() {
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
    invoke<void>('sam3_warmup')
      .then(() => {
        if (!cancelled) setBoot({ status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[sam3] warmup failed', err);
        setBoot({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.status === 'loading') return <BootScreen />;
  return <Canvas sam3Error={boot.status === 'error' ? boot.message : null} />;
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
