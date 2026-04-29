import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type SearchPaletteItem = {
  id: string;
};

type Props<T extends SearchPaletteItem> = {
  open: boolean;
  items: T[];
  onSelect: (item: T) => void;
  onClose: () => void;
  /** Returns true when the item should be included for the given query. */
  match: (item: T, query: string) => boolean;
  /** Renders a single result row. */
  renderItem: (item: T, ctx: { active: boolean }) => ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  emptyText?: string;
  emptyWhenNoItemsText?: string;
};

const MAX_RESULTS = 50;
const LISTBOX_ID = 'search-palette-listbox';

export function SearchPalette<T extends SearchPaletteItem>({
  open,
  items,
  onSelect,
  onClose,
  match,
  renderItem,
  placeholder = 'Search…',
  ariaLabel = 'Search',
  emptyText = 'No matches',
  emptyWhenNoItemsText = 'Nothing here yet',
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, MAX_RESULTS);
    return items.filter((it) => match(it, q)).slice(0, MAX_RESULTS);
  }, [items, query, match]);

  const activeIdx = results.length === 0 ? 0 : Math.min(cursor, results.length - 1);
  const activeId = results[activeIdx]?.id;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => (results.length === 0 ? 0 : Math.min(results.length - 1, i + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[activeIdx];
      if (picked) onSelect(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="search-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div className="search-input-row">
          <i className="ri-search-line search-input-icon" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-controls={LISTBOX_ID}
            aria-expanded
            aria-autocomplete="list"
            aria-activedescendant={activeId ? `search-result-${activeId}` : undefined}
            className="search-input"
            placeholder={placeholder}
            aria-label={ariaLabel}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={handleKey}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setCursor(0);
                inputRef.current?.focus();
              }}
            >
              <i className="ri-close-line" aria-hidden />
            </button>
          )}
        </div>

        <div
          className="search-results"
          ref={listRef}
          role="listbox"
          id={LISTBOX_ID}
          aria-label="Results"
        >
          {results.length === 0 ? (
            <div className="search-empty">
              {items.length === 0 ? emptyWhenNoItemsText : emptyText}
            </div>
          ) : (
            results.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                role="option"
                id={`search-result-${it.id}`}
                aria-selected={idx === activeIdx}
                data-idx={idx}
                className={`search-result ${idx === activeIdx ? 'is-active' : ''}`}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => onSelect(it)}
              >
                {renderItem(it, { active: idx === activeIdx })}
              </button>
            ))
          )}
        </div>

        <div className="search-footer">
          <span className="search-footer-hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <span>navigate</span>
          </span>
          <span className="search-footer-hint">
            <kbd>↵</kbd>
            <span>select</span>
          </span>
          <span className="search-footer-hint">
            <kbd>esc</kbd>
            <span>close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
