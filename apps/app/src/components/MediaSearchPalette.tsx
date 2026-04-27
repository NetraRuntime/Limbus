import { useCallback } from 'react';
import { SearchPalette } from './SearchPalette';

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

export function MediaSearchPalette({ open, items, onSelect, onClose }: Props) {
  const match = useCallback(
    (it: SearchItem, q: string) => it.name.toLowerCase().includes(q),
    [],
  );
  return (
    <SearchPalette
      open={open}
      items={items}
      onSelect={onSelect}
      onClose={onClose}
      match={match}
      placeholder="Search images and videos…"
      ariaLabel="Search images and videos"
      emptyText="No matches"
      emptyWhenNoItemsText="No media on the canvas yet"
      renderItem={(it) => (
        <>
          <i
            className={`${
              it.kind === 'video' ? 'ri-film-line' : 'ri-image-line'
            } search-result-icon`}
            aria-hidden
          />
          <span className="search-result-name">{it.name}</span>
          <span className="search-result-kind">{it.kind}</span>
        </>
      )}
    />
  );
}
