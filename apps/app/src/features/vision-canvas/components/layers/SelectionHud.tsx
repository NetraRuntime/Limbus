import type { MaskIdentity } from '../../../segmentation';
import { colorForTag } from '../savedTags';
import type { View } from '../../../canvas-core';
import type { ResizeHandle } from '../../hooks/useBboxResizeGesture';
import type { CanvasMedia, SegmentState } from '../../lib';

const HANDLES = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const;

type ResolvedRect = {
  tag: string;
  score: number;
  accent: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type Props = {
  paintMedia: CanvasMedia[];
  view: View;
  segments: Record<string, SegmentState>;
  selectedMask: MaskIdentity | null;
  hoveredMask: MaskIdentity | null;
  activeId: string | null;
  soloTag: string | null;
  activeResize: ResizeHandle | null;
  onResizePointerDown: (
    e: React.PointerEvent<HTMLSpanElement>,
    id: MaskIdentity,
    handle: ResizeHandle,
  ) => void;
  onResizePointerMove: (e: React.PointerEvent<HTMLSpanElement>) => void;
  onResizePointerUp: (e: React.PointerEvent<HTMLSpanElement>) => void;
};

const resolveRect = (
  id: MaskIdentity,
  paintMedia: CanvasMedia[],
  segments: Record<string, SegmentState>,
  view: View,
  activeId: string | null,
  soloLower: string | null,
): ResolvedRect | null => {
  // Hide chrome when the mask's tag is filtered out on the active image.
  // Leaves underlying state intact — clearing solo will make it reappear.
  if (
    soloLower &&
    id.imageId === activeId &&
    id.tag.toLowerCase() !== soloLower
  ) {
    return null;
  }
  const m = paintMedia.find((x) => x.id === id.imageId);
  if (!m || m.kind !== 'image') return null;
  const state = segments[id.imageId];
  if (!state) return null;
  // Match by entryId when present (two box entries can share a tag; the
  // unique boxId pins down the right entry). Fall back to a tag-only match
  // for text entries where boxId is absent.
  const entry = state.entries.find((e) => {
    if (e.status !== 'ready') return false;
    if (id.entryId !== undefined) {
      return e.kind === 'box' && e.boxId === id.entryId;
    }
    return e.tag.toLowerCase() === id.tag.toLowerCase();
  });
  if (!entry || entry.status !== 'ready') return null;
  const mask = entry.response.masks[id.maskIndex];
  if (!mask || !mask.bbox) return null;
  const [x1, y1, x2, y2] = mask.bbox;
  const fx = m.width / mask.width;
  const fy = m.height / mask.height;
  const wx = m.x + x1 * fx;
  const wy = m.y + y1 * fy;
  const ww = Math.max(1, (x2 - x1) * fx);
  const wh = Math.max(1, (y2 - y1) * fy);
  const { accent } = colorForTag(entry.tag);
  return {
    tag: entry.tag,
    score: mask.score,
    accent,
    left: wx * view.scale + view.x,
    top: wy * view.scale + view.y,
    width: ww * view.scale,
    height: wh * view.scale,
  };
};

const guidesFor = (
  handle: ResizeHandle,
  rect: ResolvedRect,
): { vGuide: number | null; hGuide: number | null } => {
  // Corner handles move two edges and light both axes; edge handles move
  // one edge and only light that axis.
  const vGuide =
    handle === 'tl' || handle === 'bl' || handle === 'l'
      ? rect.left
      : handle === 'tr' || handle === 'br' || handle === 'r'
        ? rect.left + rect.width
        : null;
  const hGuide =
    handle === 'tl' || handle === 'tr' || handle === 't'
      ? rect.top
      : handle === 'bl' || handle === 'br' || handle === 'b'
        ? rect.top + rect.height
        : null;
  return { vGuide, hGuide };
};

export function SelectionHud({
  paintMedia,
  view,
  segments,
  selectedMask,
  hoveredMask,
  activeId,
  soloTag,
  activeResize,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: Props) {
  // Viewport-space chrome for the currently-selected and currently-hovered
  // masks. Rendered outside InfiniteCanvas so border weight, corner handles
  // and the hover pill stay pixel-crisp at any zoom.
  const soloLower = soloTag ? soloTag.toLowerCase() : null;
  const selected = selectedMask
    ? resolveRect(selectedMask, paintMedia, segments, view, activeId, soloLower)
    : null;
  const hoverId =
    hoveredMask &&
    (!selectedMask ||
      hoveredMask.imageId !== selectedMask.imageId ||
      hoveredMask.tag !== selectedMask.tag ||
      hoveredMask.maskIndex !== selectedMask.maskIndex ||
      hoveredMask.entryId !== selectedMask.entryId)
      ? hoveredMask
      : null;
  const hover = hoverId
    ? resolveRect(hoverId, paintMedia, segments, view, activeId, soloLower)
    : null;

  return (
    <>
      {selected && selectedMask && (
        <>
          <div
            key={`selected-${selectedMask.imageId}-${selectedMask.tag}-${selectedMask.maskIndex}`}
            className="segment-mask-selected"
            style={
              {
                left: selected.left,
                top: selected.top,
                width: selected.width,
                height: selected.height,
                '--seg-accent': selected.accent,
              } as React.CSSProperties
            }
          >
            {HANDLES.map((corner) => (
              <span
                key={corner}
                className={`segment-mask-handle interactive ${corner}`}
                role="button"
                aria-label={`Resize ${corner}`}
                onPointerDown={(e) =>
                  onResizePointerDown(e, selectedMask, corner)
                }
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
              />
            ))}
          </div>
          {activeResize &&
            (() => {
              const { vGuide, hGuide } = guidesFor(activeResize, selected);
              return (
                <>
                  {vGuide !== null && (
                    <div
                      className="bbox-resize-guide v"
                      aria-hidden
                      style={{ left: vGuide }}
                    />
                  )}
                  {hGuide !== null && (
                    <div
                      className="bbox-resize-guide h"
                      aria-hidden
                      style={{ top: hGuide }}
                    />
                  )}
                </>
              );
            })()}
        </>
      )}
      {hover && hoverId && (
        <div
          key={`hover-${hoverId.imageId}-${hoverId.tag}-${hoverId.maskIndex}`}
          className="segment-mask-hover"
          aria-hidden
          style={
            {
              left: hover.left,
              top: hover.top,
              width: hover.width,
              height: hover.height,
              '--seg-accent': hover.accent,
            } as React.CSSProperties
          }
        >
          <span className="segment-mask-handle tl" />
          <span className="segment-mask-handle tr" />
          <span className="segment-mask-handle bl" />
          <span className="segment-mask-handle br" />
          <span className="segment-mask-hover-pill">
            <span className="segment-mask-hover-tag">{hover.tag}</span>
            <span className="segment-mask-hover-score">
              {hover.score.toFixed(2)}
            </span>
          </span>
        </div>
      )}
    </>
  );
}
