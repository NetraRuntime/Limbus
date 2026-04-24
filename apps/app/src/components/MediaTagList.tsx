import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { colorForTag } from './savedTags';

type ScreenRect = { x: number; y: number; width: number; height: number };

export type TagListEntry = {
  tag: string;
  status: 'loading' | 'ready' | 'error';
};

type Props = {
  rect: ScreenRect;
  entries: TagListEntry[];
  onRemove: (tag: string) => void;
  onSelect?: (tag: string) => void;
  soloTag?: string | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

// Mirror of MediaToolbar's constants on the right side of the active media.
const LIST_WIDTH = 140;
const LIST_GAP = 8;
const VIEWPORT_MARGIN = 8;

// Swallow pointer events so drag/marquee don't kick in when interacting with
// the list (mirror of MediaToolbar's behavior).
const stopPointer = (e: ReactPointerEvent) => e.stopPropagation();

export function MediaTagList({
  rect,
  entries,
  onRemove,
  onSelect,
  soloTag,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  if (entries.length === 0) return null;
  const soloLower = soloTag ? soloTag.toLowerCase() : null;

  const viewportWidth =
    typeof window === 'undefined' ? rect.x + rect.width + LIST_WIDTH : window.innerWidth;
  const desiredLeft = rect.x + rect.width + LIST_GAP;
  const left = Math.min(desiredLeft, viewportWidth - LIST_WIDTH - VIEWPORT_MARGIN);
  const top = Math.max(VIEWPORT_MARGIN, rect.y);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, tag: string) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove(tag);
    }
  };

  return (
    <div
      className="media-tag-list"
      role="list"
      aria-label="Tags in this image"
      style={{ left, top, width: LIST_WIDTH }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {entries.map((entry) => {
        const palette = colorForTag(entry.tag);
        const isLoading = entry.status === 'loading';
        const isError = entry.status === 'error';
        const tagLower = entry.tag.toLowerCase();
        const isSolo = soloLower !== null && soloLower === tagLower;
        const isDimmed = soloLower !== null && soloLower !== tagLower;
        const selectable = onSelect && entry.status === 'ready';
        return (
          <button
            type="button"
            key={entry.tag}
            className={`media-tag-row${isLoading ? ' is-loading' : ''}${isError ? ' is-error' : ''}${isSolo ? ' is-solo' : ''}${isDimmed ? ' is-dimmed' : ''}`}
            role="listitem"
            aria-label={`${entry.tag} — press Delete to remove`}
            aria-pressed={selectable ? isSolo : undefined}
            style={
              {
                background: palette.bg,
                color: palette.fg,
                borderColor: palette.border,
                '--tag-accent': palette.accent,
              } as CSSProperties
            }
            onClick={selectable ? () => onSelect!(entry.tag) : undefined}
            onKeyDown={(e) => handleKeyDown(e, entry.tag)}
          >
            <span className="media-tag-row-dot" style={{ background: palette.accent }} aria-hidden />
            <span className="media-tag-row-text" title={entry.tag}>
              {entry.tag}
            </span>
            {isLoading && (
              <span className="media-tag-row-spinner" aria-label="Segmenting" />
            )}
          </button>
        );
      })}
    </div>
  );
}
