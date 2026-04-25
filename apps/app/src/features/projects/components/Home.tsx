import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import { pb } from '../../../lib/pb';
import '../Home.css';

const ProjectFieldSchema = z.object({ project: z.string() });

function useItemCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      pb.collection('images').getFullList({ filter: 'deleted_at = null || deleted_at = ""', fields: 'project' }),
      pb.collection('videos').getFullList({ filter: 'deleted_at = null || deleted_at = ""', fields: 'project' }),
    ]).then(([imgs, vids]) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const raw of [...imgs, ...vids]) {
        const parsed = ProjectFieldSchema.safeParse(raw);
        if (!parsed.success) continue;
        const id = parsed.data.project;
        next[id] = (next[id] ?? 0) + 1;
      }
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return counts;
}

export function Home() {
  const state = useProjects();
  const [newOpen, setNewOpen] = useState(false);
  const itemCounts = useItemCounts();

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-title">NetraRT</div>
        <button type="button" onClick={() => setNewOpen(true)}>
          <i className="ri-add-line" aria-hidden /> New project
        </button>
      </header>
      <main>
        {state.status === 'loading' && <div className="home-empty">Loading…</div>}
        {state.status === 'error' && (
          <div className="home-empty">Failed to load projects: {state.error.message}</div>
        )}
        {state.status === 'ready' && state.projects.length === 0 && (
          <div className="home-empty">
            <p>No projects yet.</p>
            <button type="button" onClick={() => setNewOpen(true)}>
              Create your first project
            </button>
          </div>
        )}
        {state.status === 'ready' && state.projects.length > 0 && (
          <ProjectGrid projects={state.projects} itemCounts={itemCounts} />
        )}
      </main>
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
