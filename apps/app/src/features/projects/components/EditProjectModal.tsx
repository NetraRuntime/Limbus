import { useState } from 'react';
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
  const [color, setColor] = useState<ProjectColor>(project.color as ProjectColor);
  const [icon, setIcon] = useState<ProjectIcon>(project.icon as ProjectIcon);
  const [labels, setLabels] = useState<string[]>(project.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'white', padding: 24, borderRadius: 12, minWidth: 420 }}
      >
        <h2 style={{ marginTop: 0 }}>Edit project</h2>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Name</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={256}
            disabled={submitting}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Color</div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Icon</div>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 4, fontSize: 13 }}>Labels</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {labels.map((l) => (
              <span key={l} style={{ fontSize: 12, padding: '2px 6px', background: '#eee', borderRadius: 4 }}>
                #{l}{' '}
                <button
                  type="button"
                  onClick={() => setLabels(labels.filter((x) => x !== l))}
                  style={{ marginLeft: 4 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLabel();
                }
              }}
              placeholder="Add a label"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="button" onClick={addLabel}>Add</button>
          </div>
        </div>
        {error && <div role="alert" style={{ color: '#b00', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
