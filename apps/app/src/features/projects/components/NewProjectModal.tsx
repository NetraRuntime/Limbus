import { useEffect, useRef, useState } from 'react';
import { createProject } from '../api/projects';
import {
  ProjectColors,
  ProjectKinds,
  type ProjectColor,
  type ProjectIcon,
  type ProjectKind,
} from '../types/project';
import { useOpenProject } from '../hooks/useOpenProject';
import { Modal } from '../../../components/Modal';

const randomColor = (): ProjectColor =>
  ProjectColors[Math.floor(Math.random() * ProjectColors.length)]!;

const KIND_OPTIONS: ReadonlyArray<{
  value: ProjectKind;
  title: string;
  icon: string;
}> = [
  { value: 'vision', title: 'Computer Vision', icon: 'ri-eye-line' },
  { value: 'llm', title: 'LLM', icon: 'ri-chat-3-line' },
];

const KIND_DEFAULT_ICON: Record<ProjectKind, ProjectIcon> = {
  vision: 'ri-folder-3-line',
  llm: 'ri-chat-3-line',
};

type Props = {
  onClose: () => void;
};

export function NewProjectModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('vision');
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
        icon: KIND_DEFAULT_ICON[kind],
        kind,
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
              placeholder={
                kind === 'llm'
                  ? 'e.g. Customer support assistant'
                  : 'e.g. Cell biology dataset'
              }
            />
            <div
              className="project-kind-picker"
              role="radiogroup"
              aria-label="Project type"
            >
              {KIND_OPTIONS.map((opt) => {
                const active = kind === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`project-kind-pill${active ? ' is-active' : ''}`}
                    onClick={() => setKind(opt.value)}
                    disabled={submitting}
                  >
                    <i className={opt.icon} aria-hidden />
                    {opt.title}
                  </button>
                );
              })}
            </div>
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
            disabled={!name.trim() || submitting || !ProjectKinds.includes(kind)}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
