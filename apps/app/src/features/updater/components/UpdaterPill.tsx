import { useUpdater } from '../hooks/useUpdater';
import './UpdaterPill.css';

export function UpdaterPill() {
  const { state, downloadAndInstall, restartNow } = useUpdater();

  if (state.status === 'idle' || state.status === 'checking') return null;

  if (state.status === 'available') {
    return (
      <button
        type="button"
        className="updater-pill updater-pill--available"
        onClick={() => void downloadAndInstall()}
        aria-label={`Update to version ${state.version} available`}
      >
        Update {state.version} available
      </button>
    );
  }

  if (state.status === 'downloading') {
    const pct =
      state.totalBytes != null && state.totalBytes > 0
        ? Math.round((state.downloadedBytes / state.totalBytes) * 100)
        : null;
    return (
      <span className="updater-pill updater-pill--downloading" aria-live="polite">
        Downloading update… {pct != null ? `${pct}%` : ''}
      </span>
    );
  }

  if (state.status === 'ready') {
    return (
      <button
        type="button"
        className="updater-pill updater-pill--ready"
        onClick={() => void restartNow()}
      >
        Restart to update to {state.version}
      </button>
    );
  }

  return null;
}
