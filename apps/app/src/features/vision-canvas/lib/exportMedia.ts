import type { CanvasMedia } from './types';

const triggerDownload = (href: string, filename: string, revoke: boolean) => {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Safari has time to start the download.
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
};

const filenameFor = (m: CanvasMedia): string => {
  if (m.name && /\.[a-z0-9]+$/i.test(m.name)) return m.name;
  const ext = m.kind === 'video' ? '.mp4' : '.png';
  return `${m.name || m.id}${ext}`;
};

export async function exportMedia(m: CanvasMedia): Promise<void> {
  const filename = filenameFor(m);
  try {
    if (m.pending) {
      // Local blob: URL — safe to use directly.
      triggerDownload(m.src, filename, false);
      return;
    }
    const res = await fetch(m.src, { credentials: 'include' });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename, true);
  } catch (err) {
    console.warn('[export] download failed for', m.id, err);
    triggerDownload(m.src, filename, false);
  }
}
