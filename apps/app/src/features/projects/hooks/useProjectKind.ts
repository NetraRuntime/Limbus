import { useEffect, useState } from 'react';
import { getProject } from '../api/projects';
import type { ProjectKind } from '../types/project';

export type ProjectKindState =
  | { status: 'loading' }
  | { status: 'ready'; kind: ProjectKind }
  | { status: 'error'; message: string };

export function useProjectKind(projectId: string): ProjectKindState {
  const [state, setState] = useState<ProjectKindState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((p) => {
        if (!cancelled) setState({ status: 'ready', kind: p.kind });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return state;
}
