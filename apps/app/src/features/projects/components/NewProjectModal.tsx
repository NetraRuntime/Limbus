import { useState, useRef, useEffect } from 'react';
import { createProject } from '../api/projects';
import { ProjectColors, type ProjectColor } from '../types/project';
import { useOpenProject } from '../hooks/useOpenProject';

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New project"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: 'white',
          padding: 24,
          borderRadius: 12,
          minWidth: 360,
        }}
      >
        <h2 style={{ marginTop: 0 }}>New project</h2>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Name</div>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={256}
            disabled={submitting}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error && (
          <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
