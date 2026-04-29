import type { View } from '../../../../InfiniteCanvas';
import { BoxLabelPopover } from '../BoxLabelPopover';
import type { PendingBoxLabel } from '../../lib';

type Props = {
  pending: PendingBoxLabel | null;
  view: View;
  projectId: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
};

export function PendingBoxLabelLayer({
  pending,
  view,
  projectId,
  onConfirm,
  onCancel,
}: Props) {
  if (!pending) return null;
  const r = pending.worldRect;
  const left = r.x1 * view.scale + view.x;
  const top = r.y1 * view.scale + view.y;
  const width = Math.max(0, (r.x2 - r.x1) * view.scale);
  const height = Math.max(0, (r.y2 - r.y1) * view.scale);
  return (
    <>
      <div
        className="user-box user-box--pending"
        aria-hidden
        style={{ left, top, width, height }}
      >
        <span className="user-box-tick tl" />
        <span className="user-box-tick tr" />
        <span className="user-box-tick bl" />
        <span className="user-box-tick br" />
      </div>
      <BoxLabelPopover
        screenX={left}
        screenY={top + height + 8}
        maxWidth={width}
        projectId={projectId}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </>
  );
}
