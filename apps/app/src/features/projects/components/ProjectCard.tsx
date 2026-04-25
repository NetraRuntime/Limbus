import { useState } from 'react';
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => open(project)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(project);
        }
      }}
      style={{
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        background: 'white',
        position: 'relative',
      }}
    >
      <div
        className={`project-color-${project.color}`}
        style={{
          aspectRatio: '16 / 9',
          display: 'grid',
          placeItems: 'center',
          backgroundImage: thumb ? `url(${thumb})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!thumb && (
          <i className={project.icon} style={{ fontSize: 48, color: 'white' }} aria-hidden />
        )}
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className={project.icon} aria-hidden />
          <div
            style={{
              fontWeight: 600,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {project.name}
          </div>
          <button
            type="button"
            aria-label="More"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
        </div>
        {project.labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {project.labels.map((l) => (
              <span
                key={l}
                style={{ fontSize: 12, padding: '2px 6px', background: '#eee', borderRadius: 4 }}
              >
                #{l}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
          {itemCount} items · opened {formatRelative(project.last_opened_at)}
        </div>
      </div>
      {menuOpen && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '50%',
            right: 12,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 4,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              open(project);
            }}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onEdit();
            }}
          >
            Edit details…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
