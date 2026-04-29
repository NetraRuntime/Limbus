import type { View } from '../../../canvas-core';

const LABEL_OVERHANG_PX = 26;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Props = {
  selectionBBox: Bounds | null;
  marqueeRect: unknown | null;
  view: View;
  selectedCount: number;
};

export function SelectionBboxLayer({
  selectionBBox,
  marqueeRect,
  view,
  selectedCount,
}: Props) {
  if (!selectionBBox || marqueeRect) return null;
  return (
    <div
      className="selection-bbox"
      aria-hidden
      style={{
        left: selectionBBox.minX * view.scale + view.x,
        top: selectionBBox.minY * view.scale + view.y - LABEL_OVERHANG_PX,
        width: Math.max(
          0,
          (selectionBBox.maxX - selectionBBox.minX) * view.scale,
        ),
        height: Math.max(
          0,
          (selectionBBox.maxY - selectionBBox.minY) * view.scale +
            LABEL_OVERHANG_PX,
        ),
      }}
    >
      <span className="selection-bbox-handle tl" />
      <span className="selection-bbox-handle tr" />
      <span className="selection-bbox-handle bl" />
      <span className="selection-bbox-handle br" />
      <span className="selection-bbox-count">
        <i className="ri-checkbox-multiple-blank-line" aria-hidden />
        {selectedCount}
      </span>
    </div>
  );
}
