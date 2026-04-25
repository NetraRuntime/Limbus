import { useCallback } from 'react';
import type { ProjectRecord } from '../types/project';
import { openCanvasWindow } from '../../../lib/windows';
import { touchLastOpenedAt } from '../api/projects';

export function useOpenProject() {
  return useCallback(async (project: ProjectRecord) => {
    void touchLastOpenedAt(project.id).catch(() => {});
    try {
      await openCanvasWindow(project.id, project.name);
    } catch (err) {
      // Bubble the failure to the dev terminal so the click isn't a
      // silent no-op when Tauri rejects WebviewWindow creation.
      console.warn('[home] failed to open canvas window', err);
    }
  }, []);
}
