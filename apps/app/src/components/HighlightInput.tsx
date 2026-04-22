import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useLiquidGlassFilter } from './LiquidGlass';

const readViewportWidth = () => (typeof window === 'undefined' ? 1024 : window.innerWidth);

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  rect: ScreenRect;
  value: string;
  onChange: (next: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onSubmit?: (value: string) => void;
  onDeleteWhenEmpty?: () => void;
  autoFocus?: boolean;
};

export const HIGHLIGHT_INPUT_HEIGHT = 44;
export const HIGHLIGHT_INPUT_GAP = 12;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const VIEWPORT_MARGIN = 12;

// Liquid-glass tuning for a compact text input: a tight bezel and a
// thicker-than-default glass so the refraction reads at 44px tall.
const FILTER_RADIUS = 12;
const FILTER_BEZEL = 8;
const FILTER_GLASS_THICKNESS = 120;
const FILTER_REFRACTION_SCALE = 2.5;

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
  const [vw, setVw] = useState(readViewportWidth);

  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const onResize = () => setVw(readViewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = Math.max(MIN_WIDTH, Math.min(rect.width, MAX_WIDTH));
  const top = rect.y + rect.height + HIGHLIGHT_INPUT_GAP;
  const desiredLeft = rect.x + rect.width / 2 - width / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(desiredLeft, vw - width - VIEWPORT_MARGIN),
  );

  const { filterId, filterSvg } = useLiquidGlassFilter({
    width,
    height: HIGHLIGHT_INPUT_HEIGHT,
    radius: FILTER_RADIUS,
    bezelWidth: FILTER_BEZEL,
    glassThickness: FILTER_GLASS_THICKNESS,
    refractionScale: FILTER_REFRACTION_SCALE,
  });

  const backdropFilter = `url(#${filterId}) saturate(1.5)`;

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
    } else if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      value === '' &&
      onDeleteWhenEmpty
    ) {
      e.preventDefault();
      onDeleteWhenEmpty();
    }
    // Enter is handled natively by the wrapping <form>'s onSubmit.
  };

  return (
    // The form wrapper exists to capture stray pointer events that would
    // otherwise reach the canvas (pan-start) and to provide a native submit
    // target for Enter. Keyboard interaction lives on the <input>.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <form
      className="highlight-input"
      role="search"
      style={{
        top,
        left,
        width,
        height: HIGHLIGHT_INPUT_HEIGHT,
        WebkitBackdropFilter: backdropFilter,
        backdropFilter,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
    >
      {filterSvg}
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
    </form>
  );
}
