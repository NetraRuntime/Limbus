import { useState } from 'react';
import type { ProjectRecord } from '../types/project';
import { focusHome, closeCurrentCanvas } from '../../../lib/windows';
import { EditProjectModal } from './EditProjectModal';
import { DeleteProjectModal } from './DeleteProjectModal';

type Props = {
  project: ProjectRecord;
};

export function ProjectChip({ project }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div
      className={`project-chip project-color-${project.color}`}
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.9)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        zIndex: 30,
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        type="button"
        aria-label="Home"
        onClick={() => void focusHome()}
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <i className="ri-home-2-line" aria-hidden />
      </button>
      <i className={project.icon} aria-hidden style={{ color: 'var(--accent, #3b82f6)' }} />
      <span
        title={project.name}
        style={{
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 600,
        }}
      >
        {project.name}
      </span>
      <button
        type="button"
        aria-label="Project menu"
        onClick={() => setMenuOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
          }}
        >
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setEditing(true); }}>
            Edit details…
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDeleting(true); }}>
            Delete project…
          </button>
        </div>
      )}
      {editing && <EditProjectModal project={project} onClose={() => setEditing(false)} />}
      {deleting && (
        <DeleteProjectModal
          project={project}
          onClose={() => setDeleting(false)}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}
    </div>
  );
}
