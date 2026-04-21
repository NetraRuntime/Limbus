import { useEffect, useRef } from 'react';

type SidebarItem = {
  id: string;
  kind: 'image' | 'video';
  src: string;
  name: string;
  pending?: boolean;
};

type Props = {
  items: SidebarItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function FloatingSidebar({ items, activeId, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active item in view when focus switches programmatically — e.g.
  // user clicks a media on the canvas and the sidebar scrolls that thumb
  // into view so the selection is always discoverable.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  if (items.length === 0) return null;

  return (
    <div className="hud floating-sidebar" aria-label="Canvas items">
      <div
        className="floating-sidebar-inner"
        ref={listRef}
        role="toolbar"
        aria-orientation="vertical"
      >
        {items.map((m) => {
          const isActive = m.id === activeId;
          return (
            <button
              key={m.id}
              type="button"
              data-id={m.id}
              className={`floating-sidebar-item ${isActive ? 'is-active' : ''} ${m.pending ? 'is-pending' : ''}`}
              title={m.name}
              aria-label={`Focus ${m.name}`}
              aria-pressed={isActive}
              onClick={() => onSelect(m.id)}
              // Prevent the canvas pan from capturing the pointer before the
              // click resolves on the button.
              onPointerDown={(e) => e.stopPropagation()}
            >
              {m.kind === 'video' ? (
                <video
                  src={m.src}
                  muted
                  playsInline
                  preload="metadata"
                  aria-hidden
                />
              ) : (
                <img src={m.src} alt="" draggable={false} aria-hidden />
              )}
              {m.kind === 'video' && (
                <span className="floating-sidebar-kind" aria-hidden>
                  <i className="ri-play-fill" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
