import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  THEME_OPTIONS,
  type Settings,
  type ThemePreference,
} from '../hooks/useSettings';
import { Modal } from './Modal';

type ProjectSummary = {
  name: string;
  icon: string;
  color: string;
};

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

type Props = {
  open: boolean;
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onReset: () => void;
  onClose: () => void;
  project?: ProjectSummary;
  onRenameProject?: (name: string) => Promise<void> | void;
  onDeleteProject?: () => void;
};

const formatNumber = (n: number) => {
  if (Number.isInteger(n)) return n.toFixed(0);
  return n.toFixed(2).replace(/\.?0+$/, '');
};

type NumericSettingKey = keyof typeof SETTINGS_BOUNDS;

type Row = {
  key: NumericSettingKey;
  label: string;
  description: string;
  bounds: (typeof SETTINGS_BOUNDS)[NumericSettingKey];
};

const ROWS: Row[] = [
  {
    key: 'zoomSensitivity',
    label: 'Zoom sensitivity',
    description: 'How fast pinch / ctrl-wheel zooms in and out.',
    bounds: SETTINGS_BOUNDS.zoomSensitivity,
  },
  {
    key: 'panSpeed',
    label: 'Pan speed',
    description: 'Scroll / two-finger pan speed multiplier.',
    bounds: SETTINGS_BOUNDS.panSpeed,
  },
];

export function SettingsModal({
  open,
  settings,
  onChange,
  onReset,
  onClose,
  project,
  onRenameProject,
  onDeleteProject,
}: Props) {
  const [nameDraft, setNameDraft] = useState(project?.name ?? '');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  // Reset the draft when the dialog opens or the project changes — the
  // input mirrors PocketBase realtime updates between openings.
  useEffect(() => {
    if (open) {
      setNameDraft(project?.name ?? '');
      setRenameError(null);
    }
  }, [open, project?.name]);

  return (
    <Modal open={open} onClose={onClose} title="Settings">
        <div className="settings-body">
          {project && (onRenameProject || onDeleteProject) && (
            <div className={`settings-row settings-project project-color-${project.color}`}>
              <div className="settings-row-head">
                <label className="settings-label" htmlFor="setting-project-name">
                  Project name
                </label>
              </div>
              {onRenameProject ? (
                <input
                  id="setting-project-name"
                  type="text"
                  className="settings-project-input"
                  value={nameDraft}
                  maxLength={256}
                  disabled={renaming}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                    if (renameError) setRenameError(null);
                  }}
                  onBlur={async () => {
                    const trimmed = nameDraft.trim();
                    if (!trimmed || trimmed === project.name) {
                      setNameDraft(project.name);
                      return;
                    }
                    setRenaming(true);
                    try {
                      await onRenameProject(trimmed);
                    } catch (err) {
                      setRenameError(err instanceof Error ? err.message : String(err));
                      setNameDraft(project.name);
                    } finally {
                      setRenaming(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setNameDraft(project.name);
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <div className="settings-project-name" title={project.name}>
                  {project.name}
                </div>
              )}
              {renameError && (
                <p className="settings-project-error" role="alert">{renameError}</p>
              )}
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label" id="setting-theme-label">
                Appearance
              </span>
              {settings.theme === DEFAULT_SETTINGS.theme && (
                <span className="settings-value" aria-hidden>
                  <span className="settings-default-tag">default</span>
                </span>
              )}
            </div>
            <div
              className="settings-segmented"
              role="radiogroup"
              aria-labelledby="setting-theme-label"
            >
              {THEME_OPTIONS.map((option) => {
                const selected = settings.theme === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`settings-segmented-option${selected ? ' is-selected' : ''}`}
                    onClick={() => onChange('theme', option)}
                  >
                    {THEME_LABELS[option]}
                  </button>
                );
              })}
            </div>
            <div className="settings-description">
              Choose light, dark, or follow the system appearance.
            </div>
          </div>

          {ROWS.map((row) => {
            const value = settings[row.key];
            const { min, max, step } = row.bounds;
            const isDefault = value === DEFAULT_SETTINGS[row.key];
            return (
              <div className="settings-row" key={row.key}>
                <div className="settings-row-head">
                  <label className="settings-label" htmlFor={`setting-${row.key}`}>
                    {row.label}
                  </label>
                  <span className="settings-value" aria-hidden>
                    {formatNumber(value)}
                    {isDefault && <span className="settings-default-tag"> default</span>}
                  </span>
                </div>
                <input
                  id={`setting-${row.key}`}
                  className="settings-slider"
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(e) => onChange(row.key, Number(e.target.value))}
                />
                <div className="settings-description">{row.description}</div>
              </div>
            );
          })}

          {project && onDeleteProject && (
            <div className="settings-row settings-danger">
              <hr className="settings-danger-divider" aria-hidden />
              <span className="settings-label is-danger">Danger Zone</span>
              <button
                type="button"
                className="btn-ghost settings-project-btn is-danger settings-danger-btn"
                onClick={onDeleteProject}
              >
                <i className="ri-delete-bin-line" aria-hidden /> Delete project…
              </button>
              <span className="settings-description">
                Permanently removes the project and all its media. This cannot be undone.
              </span>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button type="button" className="btn-ghost" onClick={onReset}>
            Reset to defaults
          </button>
          <button type="button" className="btn-ghost btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
    </Modal>
  );
}
