import { useState } from 'react';
import { deleteProject } from '../api/projects';
import type { ProjectRecord } from '../types/project';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
  onDeleted?: () => void;
};

export function DeleteProjectModal({ project, onClose, onDeleted }: Props) {
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim() === project.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteProject(project.id);
      onClose();
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete project"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'white', padding: 24, borderRadius: 12, minWidth: 360 }}
      >
        <h2 style={{ marginTop: 0, color: '#b00' }}>Delete project</h2>
        <p>
          This will permanently delete <strong>{project.name}</strong> and all its media,
          segmentations, and tags. This action cannot be undone.
        </p>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>
            Type <code>{project.name}</code> to confirm
          </div>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            autoFocus
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error && <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="submit"
            disabled={!matches || submitting}
            style={{ background: matches ? '#b00' : undefined, color: matches ? 'white' : undefined }}
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </form>
    </div>
  );
}
