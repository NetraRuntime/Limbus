import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type Sam3BootState =
  | { status: 'loading' }
  | { status: 'no-model' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

type LocalModel = { name: string };

export function useSam3Boot(activeModel: string | null | undefined): Sam3BootState {
  const [state, setState] = useState<Sam3BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const installed = await invoke<LocalModel[]>('models_list_local');
        if (cancelled) return;
        const exists =
          activeModel != null && installed.some((m) => m.name === activeModel);
        if (!activeModel || !exists) {
          await invoke('sam3_set_active_model', { name: null });
          if (!cancelled) setState({ status: 'no-model' });
          return;
        }
        await invoke('sam3_set_active_model', { name: activeModel });
        await invoke<void>('sam3_warmup');
        if (!cancelled) setState({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[sam3] warmup failed', err);
        setState({ status: 'error', message });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeModel]);

  return state;
}
