const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const canvasLabel = (projectId: string): string => `canvas:${projectId}`;
const HOME_LABEL = 'home';

export async function openCanvasWindow(
  projectId: string,
  title: string,
): Promise<void> {
  if (!isTauri) {
    // jsdom in tests has navigation guards; assign() on a real browser navigates.
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `?project=${encodeURIComponent(projectId)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = canvasLabel(projectId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `index.html?project=${encodeURIComponent(projectId)}`,
    title,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    dragDropEnabled: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

export async function focusHome(): Promise<void> {
  if (!isTauri) {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(HOME_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(HOME_LABEL, {
    url: 'index.html',
    title: 'NetraRT',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
  });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

export async function setCanvasTitle(projectId: string, title: string): Promise<void> {
  if (!isTauri) {
    if (typeof document !== 'undefined') document.title = title;
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel(canvasLabel(projectId));
  if (win) await win.setTitle(title);
}

export async function onCanvasCloseRequested(handler: () => Promise<void> | void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const cur = getCurrentWebviewWindow();
  const unlisten = await cur.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await handler();
    } finally {
      // Resolving the prevention via destroy() is the documented Tauri 2 path.
      await cur.destroy();
    }
  });
  return () => unlisten();
}

export async function closeCurrentCanvas(): Promise<void> {
  if (!isTauri) {
    await focusHome();
    return;
  }
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await getCurrentWebviewWindow().close();
}

export async function listOpenCanvasLabels(): Promise<string[]> {
  if (!isTauri) return [];
  const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
  const all = await getAllWebviewWindows();
  return all.map((w) => w.label).filter((l) => l.startsWith('canvas:'));
}
