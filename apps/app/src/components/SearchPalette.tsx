import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchItem = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  open: boolean;
  items: SearchItem[];
  onSelect: (item: SearchItem) => void;
  onClose: () => void;
};

// Cap rendered rows so pathological libraries don't make the palette slow.
const MAX_RESULTS = 50;

export function SearchPalette({ open, items, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, MAX_RESULTS);
    return items
      .filter((it) => it.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [items, query]);

  // Fresh state on every open — Spotlight-like: always starts empty.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    // Defer one frame so the input is mounted before focus moves.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Keep the active index inside the current result window when results change.
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1));
    }
  }, [results, activeIdx]);

  // Scroll the active row into view as the user arrows through a long list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, results]);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (results.length === 0 ? 0 : Math.min(results.length - 1, i + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
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
        aria-label="Search canvas"
        onKeyDown={handleKey}
      >
        <div className="search-input-row">
          <i className="ri-search-line search-input-icon" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search images and videos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
                inputRef.current?.focus();
              }}
            >
              <i className="ri-close-line" aria-hidden />
            </button>
          )}
        </div>

        <div className="search-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="search-empty">
              {items.length === 0 ? 'No media on the canvas yet' : 'No matches'}
            </div>
          ) : (
            results.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                data-idx={idx}
                className={`search-result ${idx === activeIdx ? 'is-active' : ''}`}
                // Mouse hover sets the active row so arrow keys and mouse
                // stay in sync — matches Spotlight / Raycast behavior.
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onSelect(it)}
              >
                <i
                  className={`${
                    it.kind === 'video' ? 'ri-film-line' : 'ri-image-line'
                  } search-result-icon`}
                  aria-hidden
                />
                <span className="search-result-name">{it.name}</span>
                <span className="search-result-kind">{it.kind}</span>
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
