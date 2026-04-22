import { useEffect, useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  THEME_OPTIONS,
  type Settings,
  type ThemePreference,
} from '../hooks/useSettings';

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

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SettingsModal({ open, settings, onChange, onReset, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusable = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="settings-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2 id="settings-title" className="settings-title">
            Settings
          </h2>
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>

        <div className="settings-body">
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
        </div>

        <div className="settings-footer">
          <button type="button" className="btn-ghost" onClick={onReset}>
            Reset to defaults
          </button>
          <button type="button" className="btn-ghost btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
