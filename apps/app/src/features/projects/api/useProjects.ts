import { useEffect, useState } from 'react';
import { pb, safeRealtimeUnsubscribe, type RealtimeUnsubscribe } from '../../../lib/pb';
import { listProjects } from './projects';
import { ProjectRecordSchema, type ProjectRecord } from '../types/project';

type State =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectRecord[] }
  | { status: 'error'; error: Error };

export function useProjects(): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) setState({ status: 'ready', projects });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    let unsubscribe: RealtimeUnsubscribe | null = null;
    pb.collection('projects')
      .subscribe('*', (e) => {
        if (cancelled) return;
        setState((prev) => {
          if (prev.status !== 'ready') return prev;
          const parsed = ProjectRecordSchema.safeParse(e.record);
          if (!parsed.success) return prev;
          const projects = prev.projects.slice();
          const idx = projects.findIndex((p) => p.id === parsed.data.id);
          if (e.action === 'delete') {
            if (idx >= 0) projects.splice(idx, 1);
          } else if (idx >= 0) {
            projects[idx] = parsed.data;
          } else {
            projects.unshift(parsed.data);
          }
          return { status: 'ready', projects };
        });
      })
      .then((unsub) => {
        unsubscribe = unsub as RealtimeUnsubscribe;
        if (cancelled) safeRealtimeUnsubscribe(unsubscribe, 'useProjects');
      })
      .catch((err) => {
        console.warn('[useProjects] subscribe failed', err);
      });

    return () => {
      cancelled = true;
      safeRealtimeUnsubscribe(unsubscribe, 'useProjects');
    };
  }, []);

  return state;
}
