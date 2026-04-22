import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

export const SETTINGS_BOUNDS = {
  zoomSensitivity: { min: 1, max: 10, step: 0.5 },
  panSpeed: { min: 0.25, max: 3, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS = {
  zoomSensitivity: 4,
  panSpeed: 1,
} as const;

const SettingsSchema = z.object({
  zoomSensitivity: z
    .number()
    .finite()
    .min(SETTINGS_BOUNDS.zoomSensitivity.min)
    .max(SETTINGS_BOUNDS.zoomSensitivity.max)
    .catch(DEFAULT_SETTINGS.zoomSensitivity),
  panSpeed: z
    .number()
    .finite()
    .min(SETTINGS_BOUNDS.panSpeed.min)
    .max(SETTINGS_BOUNDS.panSpeed.max)
    .catch(DEFAULT_SETTINGS.panSpeed),
});

export type Settings = z.infer<typeof SettingsSchema>;

const STORAGE_KEY = 'netrart:settings:v1';

const readStored = (): Settings => {
  if (typeof localStorage === 'undefined') return SettingsSchema.parse({});
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SettingsSchema.parse({});
    return SettingsSchema.parse(JSON.parse(raw));
  } catch {
    return SettingsSchema.parse({});
  }
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(readStored);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      
    }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setSettings(SettingsSchema.parse({}));
  }, []);

  return { settings, update, reset };
}
