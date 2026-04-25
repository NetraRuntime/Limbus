import { useEffect, useRef, useState } from 'react';
import { updateProject } from '../api/projects';
import type { ProjectRecord } from '../types/project';
import { Modal } from '../../../components/Modal';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
};

// Rename-only edit dialog. Color and icon are decided once at create
// time and aren't user-tunable here. Labels live as canvas tags now
// (managed inline in canvas via box/text prompts), so the project
// .labels array is no longer surfaced for editing.
export function EditProjectModal({ project, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || submitting) return;
    if (next === project.name) {
      onClose();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.id, { name: next });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Rename project">
      <form onSubmit={submit}>
        <div className="project-modal-body">
          <label className="project-field">
            <span className="project-field-label">Name</span>
            <input
              ref={inputRef}
              type="text"
              className="project-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              disabled={submitting}
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
            className="btn-ghost btn-primary"
            disabled={!name.trim() || submitting}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
