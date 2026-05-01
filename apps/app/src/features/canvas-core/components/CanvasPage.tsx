import { useState, type ReactNode } from 'react';
import { CanvasShell } from './CanvasShell';
import { CanvasPageProvider } from './CanvasPageContext';
import { useCanvasTitle } from '../hooks/useCanvasTitle';
import { useSettings } from '../../../hooks/useSettings';
import { useAppliedTheme } from '../../../hooks/useAppliedTheme';
import { useHistory, useHistoryShortcuts } from '../../../lib/history';
import { DeletedBanner, useProject, type ProjectRecord } from '../../projects';

type FitFocusOpts = {
  padding?: number;
  bottomInset?: number;
  rightInset?: number;
  leftInset?: number;
};

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

type Props = {
  projectId: string;
  viewKey: string;
  searchAriaLabel?: string;
  searchTitle?: string;
  fitFocusOpts?: FitFocusOpts;
  topHudExtra?: ReactNode;
  appControlsLeading?: ReactNode;
  modals?: (ctx: CanvasPageModalsCtx) => ReactNode;
  children: ReactNode;
};

export function CanvasPage({
  projectId,
  viewKey,
  searchAriaLabel,
  searchTitle,
  fitFocusOpts,
  topHudExtra,
  appControlsLeading,
  modals,
  children,
}: Props) {
  const projectState = useProject(projectId);
  const project = projectState.status === 'ready' ? projectState.project : null;

  const { settings, update, reset } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasTitle(projectId, projectState);

  const history = useHistory({
    limit: 100,
    onError: (err, phase) => console.warn(`[history] ${phase} failed`, err),
  });
  useHistoryShortcuts(history);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  if (projectState.status === 'deleted') return <DeletedBanner />;

  const modalsCtx: CanvasPageModalsCtx = {
    settings,
    updateSetting: update,
    resetSettings: reset,
    project: project ?? undefined,
    settingsOpen,
    setSettingsOpen,
    deleteProjectOpen,
    setDeleteProjectOpen,
  };

  return (
    <CanvasShell
      projectId={projectId}
      viewKey={viewKey}
      project={project}
      panSpeed={settings.panSpeed}
      zoomSensitivity={settings.zoomSensitivity}
      searchAriaLabel={searchAriaLabel}
      searchTitle={searchTitle}
      fitFocusOpts={fitFocusOpts}
      topHudExtra={topHudExtra}
      appControlsLeading={appControlsLeading}
      onOpenSettings={() => setSettingsOpen(true)}
    >
      <CanvasPageProvider value={{ projectId, history }}>
        {children}
      </CanvasPageProvider>
      {modals && <CanvasShell.Modals>{modals(modalsCtx)}</CanvasShell.Modals>}
    </CanvasShell>
  );
}
