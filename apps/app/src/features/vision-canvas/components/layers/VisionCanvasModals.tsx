import { SettingsModal } from '../../../../components/SettingsModal';
import { ImportPreviewModal } from '../ImportPreviewModal';
import {
  DeleteProjectModal,
  updateProject,
  type ProjectRecord,
} from '../../../projects';
import { closeCurrentCanvas } from '../../../../lib/windows';
import type { useImportPreview } from '../../../../hooks/useImportPreview';
import type { useSettings } from '../../../../hooks/useSettings';

type SettingsHook = ReturnType<typeof useSettings>;
type ImportPreviewHook = ReturnType<typeof useImportPreview>;

type Props = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settings: SettingsHook['settings'];
  updateSetting: SettingsHook['update'];
  resetSettings: SettingsHook['reset'];
  project: ProjectRecord | undefined;
  deleteProjectOpen: boolean;
  setDeleteProjectOpen: (open: boolean) => void;
  preview: ImportPreviewHook;
  onConfirmImport: () => void;
};

export function VisionCanvasModals({
  settingsOpen,
  setSettingsOpen,
  settings,
  updateSetting,
  resetSettings,
  project,
  deleteProjectOpen,
  setDeleteProjectOpen,
  preview,
  onConfirmImport,
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

      <ImportPreviewModal
        state={preview.state}
        onCancel={preview.cancel}
        onImport={onConfirmImport}
        onChangeFormat={preview.setChosenFormat}
      />
    </>
  );
}
