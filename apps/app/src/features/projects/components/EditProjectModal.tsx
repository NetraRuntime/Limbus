import { useEffect, useState } from 'react';
import { updateProject } from '../api/projects';
import {
  type ProjectRecord,
  type ProjectColor,
  type ProjectIcon,
} from '../types/project';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';

type Props = {
  project: ProjectRecord;
  onClose: () => void;
};

export function EditProjectModal({ project, onClose }: Props) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState<ProjectColor>(project.color);
  const [icon, setIcon] = useState<ProjectIcon>(project.icon);
  const [labels, setLabels] = useState<string[]>(project.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateProject(project.id, { name: name.trim(), color, icon, labels });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const addLabel = () => {
    const t = labelDraft.trim();
    if (!t || labels.includes(t)) return;
    setLabels([...labels, t]);
    setLabelDraft('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit project"
      className="project-modal-backdrop"
      onClick={onClose}
    >
      <form
        className="project-modal-card project-modal-card-wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="project-modal-header">
          <h2 className="project-modal-title">Edit project</h2>
        </header>
        <div className="project-modal-body">
          <label className="project-field">
            <span className="project-field-label">Name</span>
            <input
              type="text"
              className="project-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              disabled={submitting}
            />
          </label>
          <div className="project-field">
            <span className="project-field-label">Color</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="project-field">
            <span className="project-field-label">Icon</span>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <div className="project-field">
            <span className="project-field-label">Labels</span>
            {labels.length > 0 && (
              <div className="project-card-labels">
                {labels.map((l) => (
                  <span key={l} className="project-label-edit-chip">
                    #{l}
                    <button
                      type="button"
                      aria-label={`Remove ${l}`}
                      className="project-label-edit-chip-remove"
                      onClick={() => setLabels(labels.filter((x) => x !== l))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="project-label-edit-row">
              <input
                type="text"
                className="project-input"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                placeholder="Add a label"
              />
              <button
                type="button"
                className="home-btn home-btn-outline"
                onClick={addLabel}
              >
                Add
              </button>
            </div>
          </div>
          {error && <p className="project-modal-error" role="alert">{error}</p>}
        </div>
        <footer className="project-modal-footer">
          <button
            type="button"
            className="home-btn home-btn-outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="home-btn home-btn-primary"
            disabled={!name.trim() || submitting}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  );
}
