import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pb';
import { getProject } from './projects';
import { ProjectRecordSchema, type ProjectRecord } from '../types/project';

type State =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectRecord }
  | { status: 'deleted' }
  | { status: 'error'; error: Error };

export function useProject(id: string): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getProject(id)
      .then((project) => {
        if (!cancelled) setState({ status: 'ready', project });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || /missing/i.test(msg)) {
          setState({ status: 'deleted' });
        } else {
          setState({ status: 'error', error: err instanceof Error ? err : new Error(msg) });
        }
      });

    let unsub: (() => void) | null = null;
    pb.collection('projects')
      .subscribe(id, (e) => {
        if (cancelled) return;
        if (e.action === 'delete') {
          setState({ status: 'deleted' });
          return;
        }
        const parsed = ProjectRecordSchema.safeParse(e.record);
        if (parsed.success) setState({ status: 'ready', project: parsed.data });
      })
      .then((u) => {
        unsub = u as unknown as () => void;
        if (cancelled) unsub?.();
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [id]);

  return state;
}
