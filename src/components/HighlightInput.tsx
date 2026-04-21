import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  /** Image bounding rect in screen (viewport) coords. */
  rect: ScreenRect;
  value: string;
  onChange: (next: string) => void;
  /** Pin the input (from pointer enter on the input shell). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onSubmit?: (value: string) => void;
  autoFocus?: boolean;
};

const INPUT_HEIGHT = 40;
const GAP = 10;
const MIN_WIDTH = 240;
const MAX_WIDTH = 360;
const VIEWPORT_MARGIN = 12;

// Choose "above" when there's headroom, otherwise "below". Ties go to the side
// with more space — if neither has enough room, the one with more space wins.
const placementFor = (
  rect: ScreenRect,
  viewportHeight: number,
): { placeAbove: boolean } => {
  const above = rect.y;
  const below = viewportHeight - (rect.y + rect.height);
  const needed = INPUT_HEIGHT + GAP;
  if (above >= needed && below < needed) return { placeAbove: true };
  if (below >= needed && above < needed) return { placeAbove: false };
  return { placeAbove: above >= below };
};

export function HighlightInput({
  rect,
  value,
  onChange,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onEscape,
  onSubmit,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus the input the moment it becomes autoFocused, without scrolling.
  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const width = Math.max(MIN_WIDTH, Math.min(rect.width, MAX_WIDTH));
  const { placeAbove } = placementFor(rect, viewport.h);
  const top = placeAbove
    ? Math.max(VIEWPORT_MARGIN, rect.y - INPUT_HEIGHT - GAP)
    : Math.min(viewport.h - INPUT_HEIGHT - VIEWPORT_MARGIN, rect.y + rect.height + GAP);

  let left = rect.x + rect.width / 2 - width / 2;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewport.w - width - VIEWPORT_MARGIN));

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.(value);
    }
  };

  return (
    <div
      className="highlight-input"
      style={{ top, left, width, height: INPUT_HEIGHT }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // Stop the background-click from firing when interacting with the input.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="search"
    >
      <i className="ri-sparkling-2-line highlight-input-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="highlight-input-field"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKey}
        placeholder="highlight object"
        aria-label="Highlight an object in the image"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
