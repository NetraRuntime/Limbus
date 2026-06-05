import { useEffect, useState } from 'react';
import { useUpdater } from '../hooks/useUpdater';
import './DebNotice.css';

const STORAGE_KEY = 'netra-limbus.updater.deb-notice-dismissed';

const DEB_NOTICE_ENABLED = true;

export function DebNotice() {
  const { installKind } = useUpdater();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  });

  if (!DEB_NOTICE_ENABLED) return null;
  if (installKind !== 'deb') return null;
  if (dismissed) return null;

  return (
    <div className="deb-notice" role="status">
      <span>
        Auto-updates aren't available for the .deb package. Install the AppImage
        for in-app updates.
      </span>
      <button
        type="button"
        className="deb-notice__dismiss"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, '1');
          } catch {
            // ignore
          }
          setDismissed(true);
        }}
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
