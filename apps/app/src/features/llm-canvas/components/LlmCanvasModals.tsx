import { SettingsModal } from '../../../components/SettingsModal';
import {
  DeleteProjectModal,
  updateProject,
  type ProjectRecord,
} from '../../projects';
import { closeCurrentCanvas } from '../../../lib/windows';
import type { useSettings } from '../../../hooks/useSettings';

type SettingsHook = ReturnType<typeof useSettings>;

type Props = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settings: SettingsHook['settings'];
  updateSetting: SettingsHook['update'];
  resetSettings: SettingsHook['reset'];
  project: ProjectRecord | undefined;
  deleteProjectOpen: boolean;
  setDeleteProjectOpen: (open: boolean) => void;
};

export function LlmCanvasModals({
  settingsOpen,
  setSettingsOpen,
  settings,
  updateSetting,
  resetSettings,
  project,
  deleteProjectOpen,
  setDeleteProjectOpen,
}: Props) {
  return (
    <>
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSetting}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
        project={project}
        onRenameProject={
          project
            ? async (name) => {
                await updateProject(project.id, { name });
              }
            : undefined
        }
        onDeleteProject={() => {
          setSettingsOpen(false);
          setDeleteProjectOpen(true);
        }}
      />

      {deleteProjectOpen && project && (
        <DeleteProjectModal
          project={project}
          onClose={() => {
            setDeleteProjectOpen(false);
            setSettingsOpen(true);
          }}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}
    </>
  );
}
