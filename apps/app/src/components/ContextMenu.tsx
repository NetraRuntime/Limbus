import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState({ x, y });
  const [activeIdx, setActiveIdx] = useState(-1);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width + MARGIN > vw) nx = Math.max(MARGIN, vw - rect.width - MARGIN);
    if (ny + rect.height + MARGIN > vh) ny = Math.max(MARGIN, vh - rect.height - MARGIN);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    const onBlur = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  useEffect(() => {
    if (activeIdx < 0) return;
    itemRefs.current[activeIdx]?.focus();
  }, [activeIdx]);

  const moveFocus = (delta: 1 | -1) => {
    if (items.length === 0) return;
    setActiveIdx((cur) => {
      const start = cur < 0 ? (delta === 1 ? -1 : items.length) : cur;
      for (let step = 1; step <= items.length; step++) {
        const candidate = (start + delta * step + items.length) % items.length;
        if (!items[candidate]?.disabled) return candidate;
      }
      return cur;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(items.findIndex((it) => !it.disabled));
    } else if (e.key === 'End') {
      e.preventDefault();
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i]?.disabled) {
          setActiveIdx(i);
          break;
        }
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, idx) => (
        <button
          key={item.id}
          ref={(el) => {
            itemRefs.current[idx] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={idx === Math.max(0, activeIdx) ? 0 : -1}
          className={`context-menu-item ${item.danger ? 'is-danger' : ''}`}
          disabled={item.disabled}
          onMouseEnter={() => !item.disabled && setActiveIdx(idx)}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.icon && <i className={`context-menu-icon ${item.icon}`} aria-hidden />}
          <span className="context-menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
