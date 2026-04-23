import { useEffect, useRef } from 'react';
import type { ImportState } from '../hooks/useImportPreview';
import { humanSize } from '../hooks/useImportPreview';

type Props = {
  state: ImportState;
  onCancel: () => void;
  onImport: () => void;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ImportPreviewModal({ state, onCancel, onImport }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!state.open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [state.open]);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && canImport(state)) {
        e.preventDefault();
        onImport();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const f = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onCancel, onImport]);

  if (!state.open) return null;

  const total = state.imageCount + state.videoCount;
  const summary =
    state.phase === 'scanning' && total === 0
      ? 'Scanning…'
      : `${state.imageCount} images · ${state.videoCount} videos · ${humanSize(state.bytes)}`;

  const headerTitle =
    state.phase === 'scanning' && total === 0
      ? `Scanning ${state.sourceLabel}`
      : `Import ${total} item${total === 1 ? '' : 's'} from ${state.sourceLabel}`;

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={cardRef}
        className="settings-card import-preview-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preview-title"
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2 id="import-preview-title" className="settings-title">
            {headerTitle}
          </h2>
          <button
            type="button"
            className="settings-close"
            aria-label="Cancel import"
            onClick={onCancel}
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>

        <div className="settings-body import-preview-body">
          <div className="import-preview-summary">{summary}</div>

          {state.warning && (
            <div className="import-preview-banner is-warning" role="alert">
              <i className="ri-alert-line" aria-hidden />
              <span>{state.warning.message}</span>
            </div>
          )}

          {state.error && (
            <div className="import-preview-banner is-error" role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              <span>{state.error.message}</span>
            </div>
          )}

          <ul className="import-preview-list" role="list">
            {state.descriptors.map((d) => (
              <li key={d.relativePath} className="import-preview-row">
                <i
                  className={
                    d.kind === 'video' ? 'ri-film-line' : 'ri-image-line'
                  }
                  aria-hidden
                />
                <span className="import-preview-path">{d.relativePath}</span>
                <span className="import-preview-size">{humanSize(d.size)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="settings-footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-ghost btn-primary"
            onClick={onImport}
            disabled={!canImport(state)}
          >
            {state.phase === 'scanning' ? 'Scanning…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function canImport(state: ImportState): boolean {
  return (
    state.phase === 'ready' &&
    !state.error &&
    state.descriptors.length > 0
  );
}
