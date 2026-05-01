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
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', `?project=${encodeURIComponent(projectId)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = canvasLabel(projectId);

  // getByLabel can return a stale proxy after close; isVisible() flushes actual state.
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try {
      if (await existing.isVisible()) {
        await existing.setFocus();
        return;
      }
    } catch {}
  }

  const win = new WebviewWindow(label, {
    url: `index.html?project=${encodeURIComponent(projectId)}`,
    title,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // Forward OS file drops to the webview as DOM events so the LLM-canvas
    // inspector sidebar can intercept them. With `true`, Tauri swallows the
    // drop at the native layer and the browser drop handlers never fire.
    dragDropEnabled: false,
    focus: true,
    visible: true,
    titleBarStyle: 'overlay',
    hiddenTitle: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once('tauri://created', () => resolve());
    win.once('tauri://error', (e) => {
      console.warn('[windows] WebviewWindow.create failed', e.payload);
      reject(new Error(String(e.payload)));
    });
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
    titleBarStyle: 'overlay',
    hiddenTitle: true,
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

/** Handler is bounded by CLOSE_HANDLER_TIMEOUT_MS so a stalled save can't block close. */
const CLOSE_HANDLER_TIMEOUT_MS = 1500;

export async function onCanvasCloseRequested(handler: () => Promise<void> | void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const cur = getCurrentWebviewWindow();
  let unlisten: (() => void) | null = null;
  unlisten = await cur.onCloseRequested(async (event) => {
    event.preventDefault();
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, CLOSE_HANDLER_TIMEOUT_MS),
    );
    try {
      await Promise.race([Promise.resolve(handler()), timeout]);
    } catch (err) {
      console.warn('[windows] close handler threw, closing anyway', err);
    }
    unlisten?.();
    unlisten = null;
    try {
      await cur.close();
    } catch (err) {
      console.warn('[windows] window close failed', err);
    }
  });
  return () => {
    unlisten?.();
    unlisten = null;
  };
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

export async function onHomeCloseQuit(): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebviewWindow, getAllWebviewWindows } = await import(
    '@tauri-apps/api/webviewWindow'
  );
  const cur = getCurrentWebviewWindow();
  let unlisten: (() => void) | null = null;
  unlisten = await cur.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      const all = await getAllWebviewWindows();
      await Promise.all(
        all
          .filter((w) => w.label !== cur.label)
          .map((w) => w.close().catch(() => {})),
      );
    } catch (err) {
      console.warn('[windows] failed to close other windows', err);
    }
    unlisten?.();
    unlisten = null;
    try {
      await cur.close();
    } catch (err) {
      console.warn('[windows] home close failed', err);
    }
  });
  return () => {
    unlisten?.();
    unlisten = null;
  };
}
