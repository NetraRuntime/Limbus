import type { View } from '../../../canvas-core';
import type { CanvasMedia } from '../../lib';

type Props = {
  visibleMedia: CanvasMedia[];
  view: View;
  encodingIds: Set<string>;
};

export function EncodingOverlays({ visibleMedia, view, encodingIds }: Props) {
  return (
    <>
      {visibleMedia
        .filter((m) => !m.pending && m.kind === 'image' && encodingIds.has(m.id))
        .map((m) => {
          const rx = m.x * view.scale + view.x;
          const ry = m.y * view.scale + view.y;
          const rw = m.width * view.scale;
          const rh = m.height * view.scale;
          const showLabel = rw > 110 && rh > 48;
          return (
            <div
              key={`encoding-${m.id}`}
              className="encoding-overlay"
              style={{ left: rx, top: ry, width: rw, height: rh }}
              role="status"
              aria-live="polite"
              aria-label="Encoding image for SAM3"
            >
              <div className="encoding-chip">
                <span className="encoding-spinner" aria-hidden />
                {showLabel && <span className="encoding-label">Encoding</span>}
              </div>
            </div>
          );
        })}
    </>
  );
}
