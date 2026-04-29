import { useEffect, useRef } from 'react';
import type { ImportState } from '../../../hooks/useImportPreview';
import { humanSize } from '../../../hooks/useImportPreview';
import type { AnnotationFormat } from '../../../lib/annotations';

type Props = {
  state: ImportState;
  onCancel: () => void;
  onImport: () => void;
  onChangeFormat: (f: AnnotationFormat | 'none') => void;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ImportPreviewModal({ state, onCancel, onImport, onChangeFormat }: Props) {
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
      : state.phase === 'detecting'
        ? `${state.imageCount} images · ${state.videoCount} videos — detecting annotations…`
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

          {state.annotationPlan && state.annotationPlan.format !== 'none' && (
            <div className="import-preview-annotations">
              <div className="import-preview-annotations-header">
                <i className="ri-price-tag-3-line" aria-hidden />
                <span>
                  {state.annotationPlan.format === 'mixed'
                    ? 'Detected multiple annotation formats'
                    : `Detected ${state.annotationPlan.format.toUpperCase()} annotations`}
                </span>
              </div>
              <div className="import-preview-annotations-body">
                <div>{state.annotationPlan.imagesWithAnnotations} images annotated</div>
                <div>{state.annotationPlan.totalAnnotations} annotations</div>
                <div>{state.annotationPlan.classes.length} classes</div>
                {state.annotationPlan.unmatchedAnnotations > 0 && (
                  <div>
                    {state.annotationPlan.unmatchedAnnotations} annotations with no matching image (will be skipped)
                  </div>
                )}
              </div>
              {state.annotationPlan.format === 'mixed' && (
                <div className="import-preview-annotations-picker">
                  <label htmlFor="annotation-format-picker">Import as:</label>
                  <select
                    id="annotation-format-picker"
                    value={state.chosenFormat}
                    onChange={(e) => onChangeFormat(e.target.value as AnnotationFormat | 'none')}
                  >
                    <option value="none">Pick a format…</option>
                    {(['coco', 'yolo', 'voc'] as const).map((f) =>
                      state.annotationPlan!.perFormat[f] ? (
                        <option key={f} value={f}>
                          {f.toUpperCase()} ({state.annotationPlan!.perFormat[f]!.totalAnnotations} annotations)
                        </option>
                      ) : null,
                    )}
                  </select>
                </div>
              )}
              {state.annotationPlan.warnings.map((w, i) => (
                <div key={i} className="import-preview-banner is-warning" role="alert">
                  <i className="ri-alert-line" aria-hidden />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

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
            {state.phase === 'scanning' ? 'Scanning…' : state.phase === 'detecting' ? 'Detecting…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

function canImport(state: ImportState): boolean {
  if (state.phase !== 'ready') return false;
  if (state.error) return false;
  if (state.descriptors.length === 0) return false;
  if (state.annotationPlan?.format === 'mixed' && state.chosenFormat === 'none') return false;
  return true;
}
