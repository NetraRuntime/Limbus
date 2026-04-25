import { useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '../types/project';
import type { TagRecord } from '../api/tags';
import { useOpenProject } from '../hooks/useOpenProject';

const formatRelative = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};

type Props = {
  project: ProjectRecord;
  itemCount: number;
  tags: TagRecord[];
  onEdit: () => void;
  onDelete: () => void;
};

export function ProjectCard({ project, itemCount, tags, onEdit, onDelete }: Props) {
  const open = useOpenProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      className={`project-card project-color-${project.color}`}
      onClick={() => void open(project)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void open(project);
        }
      }}
    >
      <span className="project-card-glyph" aria-hidden>
        <i className={project.icon} />
      </span>
      <div className="project-card-main">
        <span className="project-card-name">{project.name}</span>
        {tags.length > 0 && (
          <div className="project-card-labels" aria-label="Canvas labels">
            {tags.map((t) => (
              <span
                key={t.id}
                className="project-card-label"
                style={{ '--tag-color': t.color } as React.CSSProperties}
                title={t.name}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="project-card-items">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </span>
      <span className="project-card-opened">
        {formatRelative(project.last_opened_at)}
      </span>
      <div className="project-card-aside">
        <button
          type="button"
          aria-label="Project menu"
          className="project-card-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <i className="ri-more-2-fill" aria-hidden />
        </button>
      </div>
      {menuOpen && (
        <div className="project-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={() => {
              setMenuOpen(false);
              void open(project);
            }}
          >
            <i className="ri-folder-open-line" aria-hidden /> Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
          >
            <i className="ri-edit-line" aria-hidden /> Rename…
          </button>
          <button
            type="button"
            role="menuitem"
            className="project-menu-item is-danger"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <i className="ri-delete-bin-line" aria-hidden /> Delete…
          </button>
        </div>
      )}
    </div>
  );
}
