import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  /** Image bounding rect in screen coords. Input is pinned to its bottom edge. */
  rect: ScreenRect;
  value: string;
  onChange: (next: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onSubmit?: (value: string) => void;
  /**
   * Fires when Delete/Backspace is pressed while the input is empty — an
   * escape hatch so the canvas's "delete pinned media" shortcut works even
   * when the autofocused input would otherwise swallow the key.
   */
  onDeleteWhenEmpty?: () => void;
  autoFocus?: boolean;
};

export const HIGHLIGHT_INPUT_HEIGHT = 44;
export const HIGHLIGHT_INPUT_GAP = 12;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const VIEWPORT_MARGIN = 12;

// Always place the input just below the image. Horizontal: centered on the
// image midpoint, clamped to the viewport so the input never slides off-
// screen even for images near the left or right edge. Placement intentionally
// does NOT flip to "above" — it's consistently the bottom, regardless of where
// the image is on the viewport or where the cursor sits.
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
  onDeleteWhenEmpty,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const width = Math.max(MIN_WIDTH, Math.min(rect.width, MAX_WIDTH));
  const top = rect.y + rect.height + HIGHLIGHT_INPUT_GAP;

  let left = rect.x + rect.width / 2 - width / 2;
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN));

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Stop the NATIVE event from bubbling to window — React's synthetic
    // `stopPropagation` only short-circuits React's own event system; the
    // underlying native event continues past React's root delegate to any
    // window-level listeners (e.g. the canvas's delete shortcut).
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.(value);
    } else if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      value === '' &&
      onDeleteWhenEmpty
    ) {
      e.preventDefault();
      onDeleteWhenEmpty();
    }
  };

  return (
    <div
      className="highlight-input"
      style={{ top, left, width, height: HIGHLIGHT_INPUT_HEIGHT }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      // Block pan-start so focusing/typing in the input doesn't grab the
      // canvas pointer.
      onPointerDown={(e) => e.stopPropagation()}
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
