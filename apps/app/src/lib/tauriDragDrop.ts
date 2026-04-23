import { getCurrentWebview } from '@tauri-apps/api/webview';

export type TauriDropPayload = {
  paths: string[];
  position: { x: number; y: number };
};

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export function subscribeTauriDrops(
  handler: (payload: TauriDropPayload) => void,
): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void (async () => {
    try {
      const webview = getCurrentWebview();
      const unsub = await webview.onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        const payload = event.payload as unknown as {
          type: 'drop';
          paths: string[];
          position: { x: number; y: number };
        };
        handler({ paths: payload.paths, position: payload.position });
      });
      if (cancelled) unsub();
      else unlisten = unsub;
    } catch (err) {
      console.error('[tauri-drop] subscribe failed', err);
    }
  })();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
