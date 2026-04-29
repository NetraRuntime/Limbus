import type { View } from '../../../../InfiniteCanvas';
import type { DrawBoxState } from '../../lib';

type Props = {
  preview: DrawBoxState | null;
  view: View;
};

export function DrawBoxPreview({ preview, view }: Props) {
  if (!preview || !preview.moved) return null;
  const x1 = Math.min(preview.startWorldX, preview.currentWorldX);
  const y1 = Math.min(preview.startWorldY, preview.currentWorldY);
  const x2 = Math.max(preview.startWorldX, preview.currentWorldX);
  const y2 = Math.max(preview.startWorldY, preview.currentWorldY);
  return (
    <div
      className="user-box is-drawing"
      aria-hidden
      style={{
        left: x1 * view.scale + view.x,
        top: y1 * view.scale + view.y,
        width: Math.max(0, (x2 - x1) * view.scale),
        height: Math.max(0, (y2 - y1) * view.scale),
      }}
    >
      <span className="user-box-tick tl" />
      <span className="user-box-tick tr" />
      <span className="user-box-tick bl" />
      <span className="user-box-tick br" />
    </div>
  );
}
