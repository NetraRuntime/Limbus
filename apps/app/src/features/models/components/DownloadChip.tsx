import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const PROGRESS_EVENT = 'model-download-progress';

type ProgressPayload =
  | { phase: 'started'; name: string; total: number }
  | { phase: 'progress'; name: string; downloaded: number; total: number }
  | { phase: 'done'; name: string; total: number }
  | { phase: 'cancelled'; name: string }
  | { phase: 'error'; name: string; message: string };

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

type Props = {
  onClick: () => void;
};

// Persistent download indicator pinned next to the wordmark. Subscribes
// to the same Tauri event the ModelsView uses, so the chip stays
// accurate even if the user navigates away from Models. Click jumps
// back to Models so the user can cancel or watch progress in detail.
export function DownloadChip({ onClick }: Props) {
  const [active, setActive] = useState<{
    name: string;
    downloaded: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<ProgressPayload>(PROGRESS_EVENT, (event) => {
      const p = event.payload;
      if (p.phase === 'started') {
        setActive({ name: p.name, downloaded: 0, total: p.total });
      } else if (p.phase === 'progress') {
        setActive({ name: p.name, downloaded: p.downloaded, total: p.total });
      } else {
        // done / cancelled / error all clear the chip; the destination
        // view (or empty state) is responsible for surfacing the result.
        setActive(null);
      }
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!active) return null;

  const pct =
    active.total > 0 ? Math.floor((active.downloaded / active.total) * 100) : null;

  return (
    <button
      type="button"
      className="download-chip"
      onClick={onClick}
      aria-label={`Downloading ${active.name}${pct !== null ? `, ${pct}%` : ''}`}
      title="Open Models"
    >
      <span className="download-chip-spinner" aria-hidden />
      <span className="download-chip-name">{active.name}</span>
      <span className="download-chip-pct">{pct !== null ? `${pct}%` : '…'}</span>
    </button>
  );
}
