import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { FALLBACK_BACKDROP_FILTER, useLiquidGlassFilter } from '../../../components/LiquidGlass';
import { colorForTag, sanitizeTag, useSavedTags } from './savedTags';

const readViewportWidth = () => (typeof window === 'undefined' ? 1024 : window.innerWidth);

type ScreenRect = { x: number; y: number; width: number; height: number };

type Props = {
  rect: ScreenRect;
  tags: string[];
  projectId: string;
  onTagsChange: (next: string[]) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onSubmit?: (tags: string[]) => void;
  onDeleteWhenEmpty?: () => void;
  autoFocus?: boolean;
};

export const HIGHLIGHT_INPUT_HEIGHT = 44;
export const HIGHLIGHT_INPUT_GAP = 12;
const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const VIEWPORT_MARGIN = 12;
const MAX_SUGGESTIONS = 6;

// Liquid-glass tuning for a compact text input: a tight bezel and a
// thicker-than-default glass so the refraction reads at 44px tall.
const FILTER_RADIUS = 12;
const FILTER_BEZEL = 8;
const FILTER_GLASS_THICKNESS = 120;
const FILTER_REFRACTION_SCALE = 2.5;

const dedupeKey = (tag: string) => tag.trim().toLowerCase();

export function HighlightInput({
  rect,
  tags,
  projectId,
  onTagsChange,
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
  const [draft, setDraft] = useState('');
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const { remember, search } = useSavedTags(projectId);

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

  const { filterId, filterSvg, supported } = useLiquidGlassFilter({
    width,
    height: HIGHLIGHT_INPUT_HEIGHT,
    radius: FILTER_RADIUS,
    bezelWidth: FILTER_BEZEL,
    glassThickness: FILTER_GLASS_THICKNESS,
    refractionScale: FILTER_REFRACTION_SCALE,
  });

  const backdropFilter = supported
    ? `url(#${filterId}) saturate(1.5)`
    : FALLBACK_BACKDROP_FILTER;

  const suggestions = useMemo(
    () => (focused ? search(draft, tags, MAX_SUGGESTIONS) : []),
    [focused, search, draft, tags],
  );

  // Keep highlight index in range when suggestions shrink.
  useEffect(() => {
    if (suggestionIndex >= suggestions.length) setSuggestionIndex(-1);
  }, [suggestions, suggestionIndex]);

  const commitTag = (raw: string) => {
    const clean = sanitizeTag(raw);
    if (!clean) return false;
    const key = dedupeKey(clean);
    if (tags.some((t) => dedupeKey(t) === key)) return false;
    onTagsChange([...tags, clean]);
    void remember(clean);
    return true;
  };

  // Multiple commas at once (paste, etc.) split into multiple pills.
  const handleDraftChange = (next: string) => {
    if (!next.includes(',')) {
      setDraft(next);
      setSuggestionIndex(-1);
      return;
    }
    const parts = next.split(',');
    const tail = parts.pop() ?? '';
    const updated: string[] = [...tags];
    const seen = new Set(updated.map(dedupeKey));
    for (const part of parts) {
      const clean = sanitizeTag(part);
      if (!clean) continue;
      const key = dedupeKey(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      updated.push(clean);
      void remember(clean);
    }
    if (updated.length !== tags.length) onTagsChange(updated);
    setDraft(tail);
    setSuggestionIndex(-1);
  };

  const handleSuggestionClick = (tag: string) => {
    commitTag(tag);
    setDraft('');
    setSuggestionIndex(-1);
    inputRef.current?.focus({ preventScroll: true });
  };

  const removeTagAt = (index: number) => {
    if (index < 0 || index >= tags.length) return;
    const next = tags.slice(0, index).concat(tags.slice(index + 1));
    onTagsChange(next);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.nativeEvent.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      if (suggestionIndex >= 0) {
        setSuggestionIndex(-1);
        return;
      }
      onEscape?.();
      return;
    }

    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setSuggestionIndex((i) => (i + 1) % suggestions.length);
      return;
    }

    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setSuggestionIndex((i) =>
        i <= 0 ? suggestions.length - 1 : i - 1,
      );
      return;
    }

    if (e.key === 'Enter') {
      // Suggestion picked: add it and stay in the input.
      if (suggestionIndex >= 0 && suggestionIndex < suggestions.length) {
        e.preventDefault();
        commitTag(suggestions[suggestionIndex]!);
        setDraft('');
        setSuggestionIndex(-1);
        return;
      }
      // Otherwise commit the draft (if any) and submit the full tag set.
      // Form's native onSubmit fires next; intercept to control ordering.
      e.preventDefault();
      const finalTags = [...tags];
      const clean = sanitizeTag(draft);
      if (clean) {
        const key = dedupeKey(clean);
        if (!finalTags.some((t) => dedupeKey(t) === key)) {
          finalTags.push(clean);
          remember(clean);
        }
      }
      if (finalTags.length !== tags.length) onTagsChange(finalTags);
      setDraft('');
      setSuggestionIndex(-1);
      onSubmit?.(finalTags);
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && draft === '') {
      // First the pills, then the parent's "delete-when-empty" hook.
      if (tags.length > 0) {
        e.preventDefault();
        removeTagAt(tags.length - 1);
        return;
      }
      if (onDeleteWhenEmpty) {
        e.preventDefault();
        onDeleteWhenEmpty();
      }
    }
  };

  const handleBlur = () => {
    setFocused(false);
    // Defer so a click inside the suggestion list wins over blur.
    setTimeout(() => setSuggestionIndex(-1), 0);
    onBlur?.();
  };

  const handleFocus = () => {
    setFocused(true);
    onFocus?.();
  };

  // Don't let mousedown on the suggestion list blur the input.
  const preventBlur = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
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
        minHeight: HIGHLIGHT_INPUT_HEIGHT,
        WebkitBackdropFilter: backdropFilter,
        backdropFilter,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        e.stopPropagation();
        // Click on the bezel (not on a pill / button) refocuses the input.
        if (e.target === e.currentTarget) {
          inputRef.current?.focus({ preventScroll: true });
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        // Enter is intercepted in handleKey; this guards against any other
        // path that triggers the native submit.
        e.preventDefault();
      }}
    >
      {filterSvg}
      <i className="ri-sparkling-2-line highlight-input-icon" aria-hidden="true" />
      <div className="highlight-input-row">
        {tags.map((tag, i) => {
          const palette = colorForTag(tag);
          return (
            <span
              key={`${tag}-${i}`}
              className="highlight-tag"
              style={{
                background: palette.bg,
                color: palette.fg,
                borderColor: palette.border,
              }}
            >
              <span className="highlight-tag-text">{tag}</span>
              <button
                type="button"
                className="highlight-tag-remove"
                aria-label={`Remove ${tag}`}
                onPointerDown={preventBlur}
                onClick={() => {
                  removeTagAt(i);
                  inputRef.current?.focus({ preventScroll: true });
                }}
              >
                <i className="ri-close-line" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          className="highlight-input-field"
          type="text"
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKey}
          placeholder={tags.length === 0 ? 'highlight object' : ''}
          aria-label="Highlight an object in the image"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {suggestions.length > 0 && (
        <ul
          className="highlight-suggestions"
          role="listbox"
          onPointerDown={preventBlur}
        >
          {suggestions.map((tag, i) => {
            const palette = colorForTag(tag);
            const active = i === suggestionIndex;
            return (
              <li key={`sugg-${tag}`} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`highlight-suggestion${active ? ' is-active' : ''}`}
                  onMouseEnter={() => setSuggestionIndex(i)}
                  onClick={() => handleSuggestionClick(tag)}
                >
                  <span
                    className="highlight-suggestion-swatch"
                    aria-hidden
                    style={{ background: palette.border }}
                  />
                  <span className="highlight-suggestion-text">{tag}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
