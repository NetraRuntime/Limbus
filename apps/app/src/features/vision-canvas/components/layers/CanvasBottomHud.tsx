import {
  CanvasBottomHud as BaseCanvasBottomHud,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from '../../../canvas-core';
import { HIGHLIGHT_BOTTOM_INSET_PX, type CanvasMedia } from '../../lib';

type GlassRender = {
  filterSvg: React.ReactNode;
  ref: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
};

type Props = {
  searchPillGlass: GlassRender;
  statusPillGlass: GlassRender;
  controlsPillGlass: GlassRender;
  view: View;
  cursor: WorldPoint | null;
  canvasRef: React.RefObject<InfiniteCanvasHandle>;
  mediaRef: React.RefObject<CanvasMedia[]>;
  onSearchOpen: () => void;
};

const mediaBounds = (items: readonly CanvasMedia[]): WorldRect | null => {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of items) {
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.x + m.width > maxX) maxX = m.x + m.width;
    if (m.y + m.height > maxY) maxY = m.y + m.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export function CanvasBottomHud({
  searchPillGlass,
  statusPillGlass,
  controlsPillGlass,
  view,
  cursor,
  canvasRef,
  mediaRef,
  onSearchOpen,
}: Props) {
  return (
    <BaseCanvasBottomHud
      searchPillGlass={searchPillGlass}
      statusPillGlass={statusPillGlass}
      controlsPillGlass={controlsPillGlass}
      view={view}
      cursor={cursor}
      canvasRef={canvasRef}
      getFitBounds={() => mediaBounds(mediaRef.current ?? [])}
      fitFocusOpts={{ bottomInset: HIGHLIGHT_BOTTOM_INSET_PX }}
      searchAriaLabel="Search media (⌘K / Ctrl+K)"
      searchTitle="Search media (⌘K)"
      onSearchOpen={onSearchOpen}
    />
  );
}
