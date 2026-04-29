import { formatZoom, formatCoord } from '../lib/canvasView';
import type {
  InfiniteCanvasHandle,
  View,
  WorldPoint,
  WorldRect,
} from '../InfiniteCanvas';

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
  /** Returns the bounds to fit when the user clicks "Reset", or null to call `reset()`. */
  getFitBounds: () => WorldRect | null;
  /** Extra `focusOn` opts (e.g. bottomInset) for fit-all. */
  fitFocusOpts?: { padding?: number; bottomInset?: number; rightInset?: number; leftInset?: number };
  searchAriaLabel?: string;
  searchTitle?: string;
  onSearchOpen: () => void;
};

export function CanvasBottomHud({
  searchPillGlass,
  statusPillGlass,
  controlsPillGlass,
  view,
  cursor,
  canvasRef,
  getFitBounds,
  fitFocusOpts,
  searchAriaLabel = 'Search (⌘K / Ctrl+K)',
  searchTitle = 'Search (⌘K)',
  onSearchOpen,
}: Props) {
  const handleFitAll = () => {
    const rect = getFitBounds();
    if (!rect) {
      canvasRef.current?.reset();
      return;
    }
    canvasRef.current?.focusOn(rect, { padding: 0.12, ...fitFocusOpts });
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
          aria-label={searchAriaLabel}
          title={searchTitle}
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
