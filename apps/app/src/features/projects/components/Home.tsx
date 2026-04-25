import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import { SortMenu, type SortKey } from './SortMenu';
import { LabelFilterRow } from './LabelFilterRow';
import { pb } from '../../../lib/pb';
import { TagRecordSchema, type TagRecord } from '../api/tags';
import { useAutoLiquidGlassFilter } from '../../../components/LiquidGlass';
import { useSettings } from '../../../hooks/useSettings';
import { useAppliedTheme } from '../../../hooks/useAppliedTheme';
import { onCanvasCloseRequested, listOpenCanvasLabels } from '../../../lib/windows';
import '../Home.css';

const ProjectFieldSchema = z.object({ project: z.string() });

// Fetch every project's `tags` collection once and bucket by project id.
// Tags are populated when the user creates labels through box / text
// prompts on the canvas — this is the actual labelling vocabulary used
// in the project. Surfaces in each row's chip strip.
function useProjectTags(): Record<string, TagRecord[]> {
  const [byProject, setByProject] = useState<Record<string, TagRecord[]>>({});
  useEffect(() => {
    let cancelled = false;
    pb.collection('tags')
      .getFullList({ sort: '-updated' })
      .then((raw) => {
        if (cancelled) return;
        const next: Record<string, TagRecord[]> = {};
        for (const item of raw) {
          const parsed = TagRecordSchema.safeParse(item);
          if (!parsed.success) continue;
          const id = parsed.data.project;
          (next[id] ??= []).push(parsed.data);
        }
        setByProject(next);
      })
      .catch((err) => {
        console.warn('[home] failed to load tags', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return byProject;
}

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
  const tagsByProject = useProjectTags();
  const { settings } = useSettings();
  // Apply the persisted theme so light/dark stays in sync with the
  // canvas window. Settings are global (localStorage), so the same key
  // resolves on Home and Canvas.
  useAppliedTheme(settings.theme);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const newProjectGlass = useAutoLiquidGlassFilter({ radius: 12 });
  const searchGlass = useAutoLiquidGlassFilter({ radius: 999 });

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
    <div className="home-root">
      <main className="home-content">
        {state.status === 'loading' && <div className="home-empty">Loading…</div>}
        {state.status === 'error' && (
          <div className="home-empty">Failed to load projects: {state.error.message}</div>
        )}
        {state.status === 'ready' && state.projects.length === 0 && (
          <div className="home-empty">
            <p>No projects yet.</p>
            <button
              type="button"
              className="btn btn-md btn-primary"
              onClick={() => setNewOpen(true)}
            >
              Create your first project
            </button>
          </div>
        )}
        {state.status === 'ready' && state.projects.length > 0 && (
          <ProjectGrid projects={visible} itemCounts={itemCounts} tagsByProject={tagsByProject} />
        )}
      </main>

      <div className="hud hud-top-left">
        {wordmarkGlass.filterSvg}
        <div
          ref={wordmarkGlass.ref}
          className="wordmark is-liquid-glass"
          aria-label="NetraRT — Projects"
          style={wordmarkGlass.style}
        >
          <span className="wordmark-home" aria-hidden>
            <i className="ri-home-2-line wordmark-home-icon" />
            <span className="wordmark-glyph">NetraRT</span>
          </span>
          <span className="wordmark-divider" aria-hidden />
          <span className="wordmark-tag">Projects</span>
          {state.status === 'ready' && state.projects.length > 0 && (
            <>
              <span className="wordmark-divider" aria-hidden />
              <span className="home-count">
                {state.projects.length}{' '}
                {state.projects.length === 1 ? 'project' : 'projects'}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="hud hud-top-right">
        {newProjectGlass.filterSvg}
        <div
          ref={newProjectGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Project actions"
          style={newProjectGlass.style}
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setNewOpen(true)}
          >
            <i className="ri-add-line" aria-hidden /> New project
          </button>
        </div>
      </div>

      <div className="hud hud-bottom-center">
        {searchGlass.filterSvg}
        <div
          ref={searchGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Search projects"
          style={searchGlass.style}
        >
          <span className="home-search-icon" aria-hidden>
            <i className="ri-search-line" aria-hidden />
          </span>
          <input
            type="search"
            className="home-search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search projects"
          />
        </div>

        <SortMenu value={sort} onChange={setSort} />

        <LabelFilterRow available={allLabels} selected={selectedLabels} onChange={setSelectedLabels} />
      </div>

      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
