import { useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { thumbnailUrl } from '../api/projects';
import { useOpenProject } from '../hooks/useOpenProject';

const formatRelative = (iso: string | null | undefined): string => {
  if (!iso) return 'never opened';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

type Props = {
  project: ProjectRecord;
  itemCount: number;
  onEdit: () => void;
  onDelete: () => void;
};

export function ProjectCard({ project, itemCount, onEdit, onDelete }: Props) {
  const open = useOpenProject();
  const thumb = thumbnailUrl(project);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click / Escape.
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

  const thumbStyle = thumb
    ? { backgroundImage: `url(${thumb})` }
    : undefined;

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
      <div className="project-card-thumb" style={thumbStyle}>
        {!thumb && (
          <i className={`${project.icon} project-card-thumb-icon`} aria-hidden />
        )}
      </div>
      <div className="project-card-body">
        <div className="project-card-row">
          <i className={`${project.icon} project-card-icon`} aria-hidden />
          <div className="project-card-name">{project.name}</div>
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
        {project.labels.length > 0 && (
          <div className="project-card-labels">
            {project.labels.map((l) => (
              <span key={l} className="project-card-label">
                #{l}
              </span>
            ))}
          </div>
        )}
        <div className="project-card-meta">
          {itemCount} items · opened {formatRelative(project.last_opened_at)}
        </div>
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
            <i className="ri-edit-line" aria-hidden /> Edit details…
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
