import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import 'remixicon/fonts/remixicon.css';
import '@netra-limbus/design-system/tokens.css';
import '@netra-limbus/design-system/kit.css';
import '@netra-limbus/design-system/responsive.css';
import '@netra-limbus/design-system/global.css';
import './App.css';
import { App } from './App';
import { readProjectIdFromLocation, ProjectIdMissingError } from './lib/projectId';
import { Home } from './features/projects';

const forward = (level: string, message: string) => {
  invoke('debug_log', { level, message }).catch(() => {});
};

window.addEventListener('error', (ev) => {
  forward(
    'error',
    `${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}\n${ev.error?.stack ?? ''}`,
  );
});

window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason;
  const message =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack ?? ''}`
      : String(reason);
  forward('unhandledrejection', message);
});

for (const level of ['log', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    try {
      const msg = args
        .map((a) =>
          a instanceof Error
            ? `${a.message}\n${a.stack ?? ''}`
            : typeof a === 'object'
              ? JSON.stringify(a)
              : String(a),
        )
        .join(' ');
      forward(level, msg);
    } catch {}
  };
}

const root = createRoot(document.getElementById('root')!);

const renderForCurrentLocation = () => {
  let projectId: string | null = null;
  try {
    projectId = readProjectIdFromLocation();
  } catch (err) {
    if (err instanceof ProjectIdMissingError) {
      console.warn('[main] empty project query, treating as Home');
      projectId = null;
    } else {
      throw err;
    }
  }
  root.render(
    <StrictMode>
      {projectId ? <App projectId={projectId} /> : <Home />}
    </StrictMode>,
  );
};

renderForCurrentLocation();
window.addEventListener('popstate', renderForCurrentLocation);
