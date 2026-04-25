import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  THEME_OPTIONS,
  type Settings,
  type ThemePreference,
} from '../hooks/useSettings';
import { Modal } from './Modal';
import { Tabs, type TabItem } from './Tabs';

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

type TabKey = 'general' | 'project';

type Props = {
  open: boolean;
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onReset: () => void;
  onClose: () => void;
  defaultTab?: TabKey;
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
  defaultTab,
  project,
  onRenameProject,
  onDeleteProject,
}: Props) {
  const [active, setActive] = useState<TabKey>(defaultTab ?? 'general');
  const hasProjectTab = Boolean(project && (onRenameProject || onDeleteProject));

  // Reset to the requested defaultTab whenever the dialog reopens. Callers
  // pass `defaultTab="models"` when gating a project open, so the user
  // lands directly on the Models picker instead of having to navigate.
  useEffect(() => {
    if (open) setActive(defaultTab ?? 'general');
  }, [open, defaultTab]);

  const tabs: TabItem<TabKey>[] = [
    { key: 'general', label: 'General', icon: 'ri-settings-3-line' },
    ...(hasProjectTab
      ? ([{ key: 'project', label: 'Project', icon: 'ri-folder-line' }] as const)
      : []),
  ];

  return (
    <Modal open={open} onClose={onClose} title="Settings" width="wide">
      <div className="settings-tabs-row">
        <Tabs items={tabs} active={active} onChange={setActive} ariaLabel="Settings sections" />
      </div>
      <div className="settings-body">
        {active === 'general' && (
          <GeneralPanel settings={settings} onChange={onChange} />
        )}
        {active === 'project' && project && (
          <ProjectPanel
            project={project}
            onRenameProject={onRenameProject}
            onDeleteProject={onDeleteProject}
          />
        )}
      </div>

      <div className="settings-footer">
        {active === 'general' ? (
          <button type="button" className="btn-ghost" onClick={onReset}>
            Reset to defaults
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn-ghost btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

type GeneralProps = {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

function GeneralPanel({ settings, onChange }: GeneralProps) {
  return (
    <>
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
    </>
  );
}

type ProjectPanelProps = {
  project: ProjectSummary;
  onRenameProject?: (name: string) => Promise<void> | void;
  onDeleteProject?: () => void;
};

function ProjectPanel({ project, onRenameProject, onDeleteProject }: ProjectPanelProps) {
  const [nameDraft, setNameDraft] = useState(project.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  // Mirror PocketBase realtime updates between edits — when another
  // surface (Home, settings on a sibling window) renames the project,
  // the input should reflect the new value rather than overwriting it.
  useEffect(() => {
    setNameDraft(project.name);
    setRenameError(null);
  }, [project.name]);

  return (
    <>
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
          <p className="settings-project-error" role="alert">
            {renameError}
          </p>
        )}
      </div>

      {onDeleteProject && (
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
    </>
  );
}
