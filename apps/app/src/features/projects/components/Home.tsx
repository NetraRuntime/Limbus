import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import { SortMenu, type SortKey } from './SortMenu';
import { LabelFilterRow } from './LabelFilterRow';
import { pb } from '../../../lib/pb';
import { onCanvasCloseRequested, listOpenCanvasLabels } from '../../../lib/windows';
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

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const projects = state.status === 'ready' ? state.projects : [];

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.labels.forEach((l) => set.add(l)));
    return Array.from(set).sort();
  }, [projects]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    onCanvasCloseRequested(async () => {
      const open = await listOpenCanvasLabels();
      if (open.length === 0) return;
      const ok = window.confirm(
        `${open.length} project window${open.length === 1 ? '' : 's'} ${open.length === 1 ? 'is' : 'are'} still open.\n\nClose Home anyway?`,
      );
      if (!ok) {
        throw new Error('home-close-canceled');
      }
    })
      .then((c) => {
        if (cancelled) c();
        else cleanup = c;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => {
        if (selectedLabels.length && !selectedLabels.every((l) => p.labels.includes(l))) {
          return false;
        }
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || p.labels.some((l) => l.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'created') return b.created.localeCompare(a.created);
        const aT = a.last_opened_at ?? a.created;
        const bT = b.last_opened_at ?? b.created;
        return bT.localeCompare(aT);
      });
  }, [projects, query, sort, selectedLabels]);

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-title">NetraRT</div>
        <input
          className="home-search"
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SortMenu value={sort} onChange={setSort} />
        <button type="button" onClick={() => setNewOpen(true)}>
          <i className="ri-add-line" aria-hidden /> New project
        </button>
      </header>
      <LabelFilterRow available={allLabels} selected={selectedLabels} onChange={setSelectedLabels} />
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
          <ProjectGrid projects={visible} itemCounts={itemCounts} />
        )}
      </main>
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
