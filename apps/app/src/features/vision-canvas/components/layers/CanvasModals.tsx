import { SettingsModal } from '../../../../components/SettingsModal';
import { ImportPreviewModal } from '../ImportPreviewModal';
import {
  MediaSearchPalette,
  type SearchItem,
} from '../MediaSearchPalette';
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
  // Settings
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settings: SettingsHook['settings'];
  updateSetting: SettingsHook['update'];
  resetSettings: SettingsHook['reset'];
  // Project
  project: ProjectRecord | undefined;
  deleteProjectOpen: boolean;
  setDeleteProjectOpen: (open: boolean) => void;
  // Import preview
  preview: ImportPreviewHook;
  onConfirmImport: () => void;
  // Search palette
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchItems: SearchItem[];
  onSearchSelect: (item: SearchItem) => void;
};

export function CanvasModals({
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
  searchOpen,
  setSearchOpen,
  searchItems,
  onSearchSelect,
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
            // Cancel returns the user to settings — where they came from.
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

      <MediaSearchPalette
        open={searchOpen}
        items={searchItems}
        onSelect={onSearchSelect}
        onClose={() => setSearchOpen(false)}
      />
    </>
  );
}
