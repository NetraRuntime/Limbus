import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import 'remixicon/fonts/remixicon.css';
import '@netrart/design-system/tokens.css';
import '@netrart/design-system/kit.css';
import '@netrart/design-system/responsive.css';
import '@netrart/design-system/global.css';
import './App.css';
import { App } from './App';
import { readProjectIdFromLocation, ProjectIdMissingError } from './lib/projectId';
import { Home } from './features/projects';

// Forward uncaught errors/rejections AND console.{log,warn,error} to the
// Tauri process stderr via the `debug_log` command so webview diagnostics
// surface in the dev terminal without opening devtools.
const forward = (level: string, message: string) => {
  invoke('debug_log', { level, message }).catch(() => {
    /* backend not up yet — devtools console still has the original log */
  });
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
    } catch {
      /* JSON.stringify circular-ref safety */
    }
  };
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {projectId ? <App projectId={projectId} /> : <Home />}
  </StrictMode>,
);
