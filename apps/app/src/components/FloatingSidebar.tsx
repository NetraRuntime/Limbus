import { useEffect } from 'react';
import { useAutoLiquidGlassFilter } from './LiquidGlass';

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
  const glass = useAutoLiquidGlassFilter({ radius: 12 });

  useEffect(() => {
    const list = glass.ref.current;
    if (!activeId || !list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, glass.ref]);

  if (items.length === 0) return null;

  return (
    <div className="hud floating-sidebar" aria-label="Canvas items">
      {glass.filterSvg}
      <div
        className="floating-sidebar-inner is-liquid-glass"
        ref={glass.ref}
        role="toolbar"
        aria-orientation="vertical"
        style={glass.style}
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
