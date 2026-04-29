import type { View } from '../../../canvas-core';
import type { CanvasMedia, SegmentState, UserBox } from '../../lib';

type Props = {
  paintMedia: CanvasMedia[];
  view: View;
  userBoxes: Record<string, UserBox[]>;
  segments: Record<string, SegmentState>;
};

export function UserBoxesLayer({
  paintMedia,
  view,
  userBoxes,
  segments,
}: Props) {
  return (
    <>
      {paintMedia
        .filter((m) => m.kind === 'image' && (userBoxes[m.id]?.length ?? 0) > 0)
        .flatMap((m) => {
          const entries = segments[m.id]?.entries ?? [];
          return userBoxes[m.id]!.map((b) => {
            const [rx1, ry1, rx2, ry2] = b.box;
            const wx = m.x + rx1;
            const wy = m.y + ry1;
            const ww = Math.max(1, rx2 - rx1);
            const wh = Math.max(1, ry2 - ry1);
            const matched = entries.find(
              (e) => e.kind === 'box' && e.boxId === b.id,
            );
            const isLoading = matched?.status === 'loading';
            const isError = matched?.status === 'error';
            const cls = `user-box${isLoading ? ' user-box--loading' : ''}${
              isError ? ' user-box--error' : ''
            }`;
            return (
              <div
                key={`ubox-${m.id}-${b.id}`}
                className={cls}
                aria-hidden
                style={{
                  left: wx * view.scale + view.x,
                  top: wy * view.scale + view.y,
                  width: ww * view.scale,
                  height: wh * view.scale,
                }}
              >
                {isLoading && <span className="user-box-scan" aria-hidden />}
                <span className="user-box-tick tl" />
                <span className="user-box-tick tr" />
                <span className="user-box-tick bl" />
                <span className="user-box-tick br" />
              </div>
            );
          });
        })}
    </>
  );
}
