import { useEffect } from 'react';
import type { ThemePreference } from './useSettings';

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

function syncTauriWindow(applied: 'light' | 'dark') {
  if (!isTauri) return;
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(applied))
    .catch((err) => {
      console.warn('[theme] setTheme failed — check core:window:allow-set-theme capability', err);
    });
}

export function useAppliedTheme(preference: ThemePreference) {
  useEffect(() => {
    const root = document.documentElement;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const resolved: 'light' | 'dark' =
        preference === 'system' ? (mql.matches ? 'dark' : 'light') : preference;
      root.setAttribute('data-theme', resolved);
      syncTauriWindow(resolved);
    };

    apply();

    if (preference !== 'system') return;
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [preference]);
}
