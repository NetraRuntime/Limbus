import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FALLBACK_BACKDROP_FILTER, useLiquidGlassFilter } from './LiquidGlass';

const WIDTH = 240;
const HEIGHT = 44;
const VIEWPORT_MARGIN = 12;

type Props = {
  /** Anchor screen point — input centers horizontally on it and sits
   *  just below it, matching the bbox-prompt placement. */
  anchorScreenX: number;
  anchorScreenY: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

// Single-line cousin of HighlightInput. Reused styling (.highlight-input,
// .highlight-input-icon, .highlight-input-field) so the prompt looks
// identical to the bbox tagging input on the vision canvas.
export function StepNameInput({
  anchorScreenX,
  anchorScreenY,
  onSubmit,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;

  const desiredLeft = anchorScreenX - WIDTH / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(desiredLeft, vw - WIDTH - VIEWPORT_MARGIN),
  );
  const desiredTop = anchorScreenY + 12;
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(desiredTop, vh - HEIGHT - VIEWPORT_MARGIN),
  );

  const { filterId, filterSvg, supported } = useLiquidGlassFilter({
    width: WIDTH,
    height: HEIGHT,
    radius: 12,
    bezelWidth: 8,
    glassThickness: 120,
    refractionScale: 2.5,
  });

  const backdropFilter = supported
    ? `url(#${filterId}) saturate(1.5)`
    : FALLBACK_BACKDROP_FILTER;

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.nativeEvent.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      onSubmit(trimmed);
    }
  };

  return (
    <form
      className="highlight-input"
      role="search"
      style={{
        top,
        left,
        width: WIDTH,
        minHeight: HEIGHT,
        WebkitBackdropFilter: backdropFilter,
        backdropFilter,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          inputRef.current?.focus({ preventScroll: true });
        }
      }}
      onSubmit={(e) => e.preventDefault()}
    >
      {filterSvg}
      <i className="ri-node-tree highlight-input-icon" aria-hidden />
      <div className="highlight-input-row">
        <input
          ref={inputRef}
          className="highlight-input-field"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed) onSubmit(trimmed);
            else onCancel();
          }}
          onKeyDown={handleKey}
          placeholder="name this step"
          aria-label="Name this step"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div
        className={`box-label-hint step-name-hint${draft.trim() ? ' is-ready' : ''}`}
        aria-hidden
      >
        <kbd>↵</kbd>
        <span>create</span>
        <span className="box-label-hint-sep">·</span>
        <kbd>esc</kbd>
        <span>cancel</span>
      </div>
    </form>
  );
}
