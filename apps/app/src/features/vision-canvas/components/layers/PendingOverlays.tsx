import type { View } from '../../../canvas-core';
import type { CanvasMedia, UploadStatus } from '../../lib';

type Props = {
  visibleMedia: CanvasMedia[];
  view: View;
  uploadStatus: Record<string, UploadStatus>;
};

export function PendingOverlays({ visibleMedia, view, uploadStatus }: Props) {
  return (
    <>
      {visibleMedia
        .filter((m) => m.pending)
        .map((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          // Hide the label for small rects so the pill doesn't overflow.
          const showLabel = rw > 160 && rh > 72;
          const status = uploadStatus[m.id];
          const isError = status?.phase === 'error';
          let label = 'Uploading';
          if (status) {
            if (status.phase === 'error') {
              label = status.message
                ? `Failed — ${status.message}`
                : 'Failed';
            } else if (status.phase === 'finalizing') {
              label = 'Finalizing';
            } else {
              label = `${Math.floor(status.pct * 100)}%`;
            }
          }
          return (
            <div
              key={`pending-${m.id}`}
              className={`pending-overlay ${isError ? 'is-error' : ''}`}
              style={{ left: rx, top: ry, width: rw, height: rh }}
              role="status"
              aria-live="polite"
              aria-label={`${m.kind} ${isError ? 'upload failed' : 'uploading'}, ${label}`}
              title={isError ? label : undefined}
            >
              <div className={`pending-chip ${isError ? 'is-error' : ''}`}>
                {isError ? (
                  <i className="ri-error-warning-line pending-chip-icon" aria-hidden />
                ) : (
                  <span className="pending-spinner" aria-hidden />
                )}
                {showLabel && <span className="pending-label">{label}</span>}
              </div>
            </div>
          );
        })}
    </>
  );
}
