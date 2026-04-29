import { useEffect, useMemo, useRef, useState } from 'react';
import { colorForTag, useSavedTags } from '../../../components/savedTags';
import { useBoxLabelKeyboard } from '../hooks/useBoxLabelKeyboard';

export type BoxLabelPopoverProps = {
  /** Anchor in viewport pixels — popover positions itself just below this. */
  screenX: number;
  screenY: number;
  maxWidth: number;
  projectId: string;
  onConfirm: (label: string) => void;
  onCancel: () => void;
};

/** Click-outside is intentionally NOT cancel; matches Figma rename pattern. */
export function BoxLabelPopover({
  screenX,
  screenY,
  maxWidth,
  projectId,
  onConfirm,
  onCancel,
}: BoxLabelPopoverProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { search } = useSavedTags(projectId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;
  const suggestions = useMemo(
    () => search(value, [] as string[], 6),
    [search, value],
  );

  const commit = (label: string) => {
    const clean = label.trim();
    if (clean) onConfirm(clean);
  };

  const { activeIdx, setActiveIdx, resetActive, onKeyDown } =
    useBoxLabelKeyboard({
      suggestionsCount: suggestions.length,
      canConfirm,
      onCommit: (idx) =>
        commit(idx === null ? trimmed : suggestions[idx]!),
      onCancel,
    });

  return (
    <div
      className="box-label-popover"
      role="dialog"
      aria-label="Label this object"
      style={{
        left: screenX,
        top: screenY,
        maxWidth: Math.max(180, maxWidth),
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <input
        ref={inputRef}
        className="box-label-input"
        type="text"
        placeholder="Name this object…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          resetActive();
        }}
        onKeyDown={onKeyDown}
        maxLength={64}
        aria-label="Object label"
        autoComplete="off"
        spellCheck={false}
      />
      {suggestions.length > 0 && (
        <ul
          className="highlight-suggestions"
          role="listbox"
          onPointerDown={(e) => e.preventDefault()}
        >
          {suggestions.map((tag, i) => {
            const palette = colorForTag(tag);
            const active = i === activeIdx;
            return (
              <li key={`sugg-${tag}`} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`highlight-suggestion${active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(tag)}
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
      <div
        className={`box-label-hint${canConfirm ? ' is-ready' : ''}`}
        aria-hidden
      >
        <kbd>↵</kbd>
        <span>segment</span>
        <span className="box-label-hint-sep">·</span>
        <kbd>esc</kbd>
        <span>cancel</span>
      </div>
    </div>
  );
}
