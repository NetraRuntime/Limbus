import { createContext, useContext } from 'react';
import type { useHistory } from '../../../lib/history';
import type { useSettings } from '../../../hooks/useSettings';
import type { ProjectRecord } from '../../projects';

type SettingsHook = ReturnType<typeof useSettings>;

export type CanvasPageModalsCtx = {
  settings: SettingsHook['settings'];
  updateSetting: SettingsHook['update'];
  resetSettings: SettingsHook['reset'];
  project: ProjectRecord | undefined;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  deleteProjectOpen: boolean;
  setDeleteProjectOpen: (open: boolean) => void;
};

export type CanvasPageValue = {
  projectId: string;
  history: ReturnType<typeof useHistory>;
  modalsCtx: CanvasPageModalsCtx;
};

const CanvasPageContextRef = createContext<CanvasPageValue | null>(null);
CanvasPageContextRef.displayName = 'CanvasPageContext';

export const CanvasPageProvider = CanvasPageContextRef.Provider;

export function useCanvasPage(): CanvasPageValue {
  const value = useContext(CanvasPageContextRef);
  if (!value) {
    throw new Error('useCanvasPage must be used inside a CanvasPage.');
  }
  return value;
}
