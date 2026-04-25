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

  // Reuse an existing canvas window only if it's still visible —
  // getByLabel can return a stale proxy after the user closed it,
  // which then makes setFocus() succeed silently against a dead
  // window and we never spawn a new one. Probing isVisible() flushes
  // the actual state.
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try {
      if (await existing.isVisible()) {
        await existing.setFocus();
        return;
      }
    } catch {
      // window is gone — fall through to create a fresh one.
    }
  }

  const win = new WebviewWindow(label, {
    url: `index.html?project=${encodeURIComponent(projectId)}`,
    title,
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    dragDropEnabled: true,
    focus: true,
    visible: true,
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

/**
 * Run `handler` when the current window is about to close, then let
 * the close proceed. The handler must not block close — if it stalls
 * (e.g. PB thumbnail upload over a slow network), we timeout after
 * 1.5s and close anyway. Throws are logged but never abort the close.
 *
 * Implementation: we call `event.preventDefault()` to hold the close
 * while the handler runs, then `unlisten()` ourselves and re-issue
 * `cur.close()`. Tauri 2 only grants us `core:window:allow-close`
 * (not `allow-destroy`), so `destroy()` rejects silently — `close()`
 * is the supported path. Unlistening before the second `close()` call
 * prevents the listener from preventDefault-looping forever.
 */
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

/**
 * Wire the current window's close button so closing Home tears down
 * every window the user can see. Tauri 2 doesn't expose `exit()` from
 * `@tauri-apps/api/app` and we don't ship the process plugin yet, so
 * the best we can do without adding a dependency is destroy every
 * webview. On Linux/Windows this terminates the app naturally; on
 * macOS the process lingers but has no visible UI — Cmd+Q quits the
 * lingering process. Either way, closing Home no longer "redirects"
 * focus to a canvas window.
 */
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
      // Close non-Home windows first so focus doesn't briefly land on
      // them as Home dies. Use close() (the granted permission) — not
      // destroy(), which we don't have a capability for.
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
