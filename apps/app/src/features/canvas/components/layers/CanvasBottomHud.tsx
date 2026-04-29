import { formatZoom, formatCoord } from '../../../../lib/canvasView';
import type {
  InfiniteCanvasHandle,
  View,
  WorldPoint,
} from '../../../../InfiniteCanvas';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  type CanvasMedia,
} from '../../lib';

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
  const handleFitAll = () => {
    const items = mediaRef.current ?? [];
    if (items.length === 0) {
      canvasRef.current?.reset();
      return;
    }
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
    canvasRef.current?.focusOn(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
    );
  };

  return (
    <div className="hud hud-bottom-center">
      {searchPillGlass.filterSvg}
      {statusPillGlass.filterSvg}
      {controlsPillGlass.filterSvg}
      <div
        ref={searchPillGlass.ref}
        className="btn-cluster is-liquid-glass"
        role="group"
        aria-label="Search"
        style={searchPillGlass.style}
      >
        <button
          className="btn-ghost"
          type="button"
          aria-label="Search media (⌘K / Ctrl+K)"
          title="Search media (⌘K)"
          onClick={onSearchOpen}
        >
          <i className="ri-search-line" aria-hidden />
        </button>
      </div>

      <div
        ref={statusPillGlass.ref}
        className="status-pill is-liquid-glass"
        style={statusPillGlass.style}
      >
        <span className="status-label">Zoom</span>
        <span className="status-value">{formatZoom(view.scale)}</span>
        <span className="status-sep" aria-hidden />
        <span className="status-label">X</span>
        <span className="status-value">{formatCoord(cursor?.worldX)}</span>
        <span className="status-label">Y</span>
        <span className="status-value">{formatCoord(cursor?.worldY)}</span>
      </div>

      <div
        ref={controlsPillGlass.ref}
        className="btn-cluster is-liquid-glass"
        role="group"
        aria-label="Canvas controls"
        style={controlsPillGlass.style}
      >
        <button
          className="btn-ghost"
          type="button"
          aria-label="Zoom out"
          onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
        >
          −
        </button>
        <button
          className="btn-ghost"
          type="button"
          aria-label="Fit all to view"
          onClick={handleFitAll}
        >
          Reset
        </button>
        <button
          className="btn-ghost"
          type="button"
          aria-label="Zoom in"
          onClick={() => canvasRef.current?.zoomBy(1.4)}
        >
          +
        </button>
      </div>
    </div>
  );
}
