import { useCallback, useEffect, useState } from 'react';

export type Settings = {
  /** Pinch / ctrl-wheel zoom sensitivity multiplier. 1 is slow, 10 is
   *  extremely fast. Applied inside InfiniteCanvas as the factor on the
   *  per-event zoom intensity. */
  zoomSensitivity: number;
  /** Plain wheel / trackpad two-finger pan speed multiplier. 1 = 1:1 with
   *  the OS-reported scroll delta. */
  panSpeed: number;
};

export const DEFAULT_SETTINGS: Settings = {
  zoomSensitivity: 4,
  panSpeed: 1,
};

export const SETTINGS_BOUNDS = {
  zoomSensitivity: { min: 1, max: 10, step: 0.5 },
  panSpeed: { min: 0.25, max: 3, step: 0.05 },
} as const;

const STORAGE_KEY = 'netrart:settings:v1';

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const sanitize = (raw: unknown): Settings => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Record<keyof Settings, unknown>>;
  if (typeof r.zoomSensitivity === 'number' && Number.isFinite(r.zoomSensitivity)) {
    base.zoomSensitivity = clamp(
      r.zoomSensitivity,
      SETTINGS_BOUNDS.zoomSensitivity.min,
      SETTINGS_BOUNDS.zoomSensitivity.max,
    );
  }
  if (typeof r.panSpeed === 'number' && Number.isFinite(r.panSpeed)) {
    base.panSpeed = clamp(
      r.panSpeed,
      SETTINGS_BOUNDS.panSpeed.min,
      SETTINGS_BOUNDS.panSpeed.max,
    );
  }
  return base;
};

const readStored = (): Settings => {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(readStored);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* quota / private mode — silently skip */
    }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, update, reset };
}
