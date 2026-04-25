import { useEffect, useRef, useState } from 'react';
import { createProject } from '../api/projects';
import { ProjectColors, type ProjectColor } from '../types/project';
import { useOpenProject } from '../hooks/useOpenProject';
import { Modal } from '../../../components/Modal';

const randomColor = (): ProjectColor =>
  ProjectColors[Math.floor(Math.random() * ProjectColors.length)]!;

type Props = {
  onClose: () => void;
};

export function NewProjectModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = useOpenProject();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        color: randomColor(),
        icon: 'ri-folder-3-line',
        labels: [],
      });
      onClose();
      await open(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New project">
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
              placeholder="e.g. Cell biology dataset"
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
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
