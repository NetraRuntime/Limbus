import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { colorForTag, sanitizeTag, useSavedTags } from './savedTags';
import { useAutoLiquidGlassFilter } from './LiquidGlass';

type Props = {
  projectId: string;
  /** Glyph-only button; the label is supplied via aria-label. */
  className?: string;
};

export function SavedTagsPopover({ projectId, className }: Props) {
  const { tags, remove, rename } = useSavedTags(projectId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const glass = useAutoLiquidGlassFilter({ radius: 12 });
  const popoverGlass = useAutoLiquidGlassFilter({ radius: 16 });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
      setEditing(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editing) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [editing]);

  useLayoutEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    searchInputRef.current?.focus({ preventScroll: true });
  }, [open]);

  const filteredTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    const starts: string[] = [];
    const contains: string[] = [];
    for (const t of tags) {
      const n = t.toLowerCase();
      if (n.startsWith(q)) starts.push(t);
      else if (n.includes(q)) contains.push(t);
    }
    return [...starts, ...contains];
  }, [query, tags]);

  const startEdit = useCallback((tag: string) => {
    setEditing(tag);
    setDraft(tag);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const next = sanitizeTag(draft);
    if (next && next !== editing) void rename(editing, next);
    setEditing(null);
    setDraft('');
  }, [editing, draft, rename]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
  }, []);

  const handleEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.nativeEvent.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const buttonTitle = useMemo(
    () => (tags.length === 0 ? 'Saved tags' : `Saved tags · ${tags.length}`),
    [tags.length],
  );

  return (
    <>
      {glass.filterSvg}
      <div
        className={`btn-cluster is-liquid-glass${className ? ` ${className}` : ''}`}
        role="group"
        aria-label="Saved tags"
        ref={glass.ref}
        style={glass.style}
      >
        <button
          ref={buttonRef}
          className={`btn-ghost${open ? ' is-active' : ''}`}
          type="button"
          aria-label={buttonTitle}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={buttonTitle}
          onClick={() => {
            setOpen((o) => !o);
            setEditing(null);
          }}
        >
          <i className="ri-price-tag-3-line" aria-hidden />
        </button>
      </div>

      {open && popoverGlass.filterSvg}
      {open && (
        <div
          ref={(el) => {
            popoverRef.current = el;
            popoverGlass.ref(el);
          }}
          className="saved-tags-popover is-liquid-glass"
          role="dialog"
          aria-label="Saved tags"
          onPointerDown={(e) => e.stopPropagation()}
          style={popoverGlass.style}
        >
          <div className="saved-tags-header">
            <span className="saved-tags-title">Saved tags</span>
            <span className="saved-tags-count">
              {query.trim() && filteredTags.length !== tags.length
                ? `${filteredTags.length} / ${tags.length}`
                : tags.length}
            </span>
          </div>
          {tags.length > 0 && (
            <div className="saved-tags-search">
              <i className="ri-search-line saved-tags-search-icon" aria-hidden />
              <input
                ref={searchInputRef}
                className="saved-tags-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.nativeEvent.stopPropagation();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    if (query) setQuery('');
                    else setOpen(false);
                  }
                }}
                placeholder="Search tags"
                aria-label="Search saved tags"
                spellCheck={false}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="saved-tags-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <i className="ri-close-line" aria-hidden />
                </button>
              )}
            </div>
          )}
          {tags.length === 0 ? (
            <div className="saved-tags-empty">
              No saved tags yet. Commit a pill in the highlight input and
              it'll show up here.
            </div>
          ) : filteredTags.length === 0 ? (
            <div className="saved-tags-empty">
              No tags match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <ul className="saved-tags-list" role="list">
              {filteredTags.map((tag) => {
                const palette = colorForTag(tag);
                const isEditing = editing === tag;
                return (
                  <li
                    key={tag}
                    className="saved-tags-item"
                    style={{
                      background: palette.bg,
                      color: palette.fg,
                      borderColor: palette.border,
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        className="saved-tags-edit-input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleEditKey}
                        onBlur={commitEdit}
                        maxLength={80}
                        aria-label={`Rename "${tag}"`}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    ) : (
                      <button
                        type="button"
                        className="saved-tags-label"
                        onDoubleClick={() => startEdit(tag)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'F2') {
                            e.preventDefault();
                            startEdit(tag);
                          }
                        }}
                        aria-label={`${tag} (double-click to rename)`}
                        title="Double-click to rename"
                      >
                        {tag}
                      </button>
                    )}
                    <button
                      type="button"
                      className="saved-tags-remove"
                      aria-label={`Remove "${tag}"`}
                      title="Remove"
                      onClick={() => {
                        if (isEditing) cancelEdit();
                        void remove(tag);
                      }}
                    >
                      <i className="ri-close-line" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
