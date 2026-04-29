import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type Point = { x: number; y: number };

type Props = {
  id: string;
  x: number;
  y: number;
  name: string;
  /** Current canvas zoom — needed so screen drag deltas map to world. */
  scale: number;
  /** Optional Remix Icon class for a leading glyph. */
  icon?: string;
  /** Visual variant. `accent` colors the icon with the canvas accent. */
  variant?: 'default' | 'accent';
  /** When true, double-click and the context-menu "Rename" item are wired. */
  canRename?: boolean;
  /** When true, the context menu offers Delete. */
  canDelete?: boolean;
  /** Add a right-edge connection port that emits `onConnectStart`. */
  port?: 'right' | 'none';

  /** Continuous drag updates — fires on every pointer move. */
  onMove: (id: string, next: Point) => void;
  /** Drag committed — parent should push an undo entry covering prev → next. */
  onMoveCommit?: (id: string, prev: Point, next: Point) => void;
  /** Rename committed (only fires when name actually changed). */
  onRename?: (id: string, prev: string, next: string) => void;
  /** Delete picked from context menu. */
  onDelete?: (id: string) => void;
  /** Output port grabbed — argument is the port's world coords. */
  onConnectStart?: (worldPoint: Point) => void;
  /** Fires on size change so parent can keep edge endpoints attached as label width shifts. */
  onMeasure?: (id: string, size: { width: number; height: number }) => void;
  /** Pointer-up without a drag → click; parent treats as select intent. */
  onSelect?: (id: string) => void;
  /** Visual selection state — paints a focus ring around the node. */
  selected?: boolean;
};

export function Node({
  id,
  x,
  y,
  name,
  scale,
  icon,
  variant = 'default',
  canRename = false,
  canDelete = false,
  port = 'none',
  onMove,
  onMoveCommit,
  onRename,
  onDelete,
  onConnectStart,
  onMeasure,
  onSelect,
  selected = false,
}: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [editing]);

  useLayoutEffect(() => {
    if (!onMeasure) return;
    const el = nodeRef.current;
    if (!el) return;
    const report = () =>
      onMeasure(id, { width: el.offsetWidth, height: el.offsetHeight });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onMeasure, name]);

  const beginRename = () => {
    if (!canRename) return;
    setDraft(name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === name) {
      setDraft(name);
      return;
    }
    onRename?.(id, name, trimmed);
  };

  const cancelRename = () => {
    setEditing(false);
    setDraft(name);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.nativeEvent.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (editing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: x,
      startY: y,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const dx = (e.clientX - d.startClientX) / Math.max(scale, 1e-6);
    const dy = (e.clientY - d.startClientY) / Math.max(scale, 1e-6);
    if (!d.moved && Math.hypot(dx, dy) > 1) d.moved = true;
    onMove(id, { x: d.startX + dx, y: d.startY + dy });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    if (d.moved) {
      onMoveCommit?.(id, { x: d.startX, y: d.startY }, { x, y });
    } else if (!editing) {
      onSelect?.(id);
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canRename && !canDelete) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onPortPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const node = nodeRef.current;
    if (!node) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    onConnectStart?.({ x: x + w, y: y + h / 2 });
  };

  const menuItems: ContextMenuItem[] = [];
  if (canRename) {
    menuItems.push({
      id: 'rename',
      label: 'Rename',
      icon: 'ri-edit-line',
      onSelect: beginRename,
    });
  }
  if (canDelete) {
    menuItems.push({
      id: 'delete',
      label: 'Delete',
      icon: 'ri-delete-bin-line',
      danger: true,
      onSelect: () => onDelete?.(id),
    });
  }

  return (
    <>
      <div
        ref={nodeRef}
        className={`canvas-node canvas-node-${variant}${selected ? ' is-selected' : ''}`}
        style={{ left: x, top: y }}
        role="button"
        aria-label={name}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if (!canRename) return;
          e.stopPropagation();
          beginRename();
        }}
        onContextMenu={onContextMenu}
      >
        {icon && (
          <span className="canvas-node-icon" aria-hidden>
            <i className={icon} />
          </span>
        )}
        {editing ? (
          <input
            ref={inputRef}
            className="canvas-node-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onRenameKey}
            onBlur={commitRename}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Rename ${name}`}
          />
        ) : (
          <span className="canvas-node-label">{name}</span>
        )}
        {port === 'right' && (
          <button
            type="button"
            className="canvas-node-port canvas-node-port-right"
            aria-label="Drag to connect"
            onPointerDown={onPortPointerDown}
          />
        )}
      </div>
      {menu && menuItems.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
