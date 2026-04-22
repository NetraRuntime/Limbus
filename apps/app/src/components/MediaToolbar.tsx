import type { PointerEvent as ReactPointerEvent } from 'react';

export type CanvasTool = 'drag' | 'box';

// Swallow pointer events on the toolbar so they don't reach the canvas
// background (which would start a marquee) or the underlying media element
// (which would start a drag). Clicks bubble through React separately and
// land on the buttons themselves.
const stopPointer = (e: ReactPointerEvent) => e.stopPropagation();

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  rect: ScreenRect;
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

const TOOLBAR_WIDTH = 36;
const TOOLBAR_GAP = 8;
const VIEWPORT_MARGIN = 8;

const TOOLS: ReadonlyArray<{
  id: CanvasTool;
  icon: string;
  label: string;
  hint: string;
}> = [
  { id: 'drag', icon: 'ri-drag-move-2-line', label: 'Drag tool', hint: 'Move image or video' },
  { id: 'box', icon: 'ri-square-line', label: 'Box tool', hint: 'Draw a box to annotate' },
];

export function MediaToolbar({
  rect,
  tool,
  onToolChange,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const left = Math.max(VIEWPORT_MARGIN, rect.x - TOOLBAR_WIDTH - TOOLBAR_GAP);
  const top = Math.max(VIEWPORT_MARGIN, rect.y);

  return (
    <div
      className="media-toolbar"
      role="toolbar"
      aria-label="Media tools"
      aria-orientation="vertical"
      style={{ left, top, width: TOOLBAR_WIDTH }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {TOOLS.map((t) => {
        const active = t.id === tool;
        return (
          <button
            key={t.id}
            type="button"
            className={`media-toolbar-btn ${active ? 'is-active' : ''}`}
            aria-label={t.label}
            aria-pressed={active}
            title={`${t.label} — ${t.hint}`}
            onClick={() => onToolChange(t.id)}
          >
            <i className={t.icon} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
