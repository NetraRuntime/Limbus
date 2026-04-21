import { useEffect, useRef } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  type Settings,
} from '../hooks/useSettings';

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

type Row = {
  key: keyof Settings;
  label: string;
  description: string;
  bounds: (typeof SETTINGS_BOUNDS)[keyof Settings];
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

export function SettingsModal({ open, settings, onChange, onReset, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

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
          <h2 id="settings-title" className="settings-title">Settings</h2>
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
