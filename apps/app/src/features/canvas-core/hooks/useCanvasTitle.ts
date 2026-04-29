import { useEffect } from 'react';
import { setCanvasTitle } from '../../../lib/windows';
import type { useProject } from '../../projects';

type ProjectState = ReturnType<typeof useProject>;

/** Mirrors the project name to the OS window title while the project is loaded. */
export function useCanvasTitle(
  projectId: string,
  projectState: ProjectState,
): void {
  useEffect(() => {
    if (projectState.status !== 'ready') return;
    void setCanvasTitle(projectId, projectState.project.name);
  }, [projectId, projectState]);
}
