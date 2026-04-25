import { useCallback } from 'react';
import type { ProjectRecord } from '../types/project';
import { openCanvasWindow } from '../../../lib/windows';
import { touchLastOpenedAt } from '../api/projects';

export function useOpenProject() {
  return useCallback(async (project: ProjectRecord) => {
    void touchLastOpenedAt(project.id).catch(() => {});
    await openCanvasWindow(project.id, project.name);
  }, []);
}
