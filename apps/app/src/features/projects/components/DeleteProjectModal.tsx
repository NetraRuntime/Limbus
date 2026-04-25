import { useState } from 'react';
import { deleteProject } from '../api/projects';
import type { ProjectRecord } from '../types/project';
import { Modal } from '../../../components/Modal';

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
      // Successful delete → only the success callback fires. The parent
      // owns "what to do after delete" (e.g. close the canvas window).
      // We deliberately do not call onClose here so cancel-vs-success
      // can be distinguished by the parent.
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Delete project" titleVariant="danger">
      <form onSubmit={submit}>
        <div className="project-modal-body">
          <p>
            This will permanently delete <strong>{project.name}</strong> and all its
            media, segmentations, and tags. This action cannot be undone.
          </p>
          <label className="project-field">
            <span className="project-field-label">
              Type <code>{project.name}</code> to confirm
            </span>
            <input
              type="text"
              className="project-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </label>
          {error && <p className="project-modal-error" role="alert">{error}</p>}
        </div>
        <footer className="project-modal-footer">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-ghost settings-project-btn is-danger"
            disabled={!matches || submitting}
          >
            <i className="ri-delete-bin-line" aria-hidden />
            {submitting ? 'Deleting…' : 'Delete project'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
