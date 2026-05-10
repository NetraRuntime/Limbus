import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import { SortMenu, type SortKey } from './SortMenu';
import { LabelFilterRow } from './LabelFilterRow';
import { pb, safeRealtimeUnsubscribe, type RealtimeUnsubscribe } from '../../../lib/pb';
import { TagRecordSchema, type TagRecord } from '../api/tags';
import { useAutoLiquidGlassFilter } from '../../../components/LiquidGlass';
import { SettingsModal } from '../../../components/SettingsModal';
import { useSettings } from '../../../hooks/useSettings';
import { useAppliedTheme } from '../../../hooks/useAppliedTheme';
import { onHomeCloseQuit } from '../../../lib/windows';
import { ModelsView } from '../../models/components/ModelsView';
import { DownloadChip } from '../../models/components/DownloadChip';
import { UpdaterPill, DebNotice } from '../../updater';
import '../Home.css';

const ProjectFieldSchema = z.object({ project: z.string() });

const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

type View = 'projects' | 'models';
type LocalModel = { name: string };

function useProjectTags(): Record<string, TagRecord[]> {
  const [byProject, setByProject] = useState<Record<string, TagRecord[]>>({});

  useEffect(() => {
    let cancelled = false;

    const reload = () => {
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
    };

    reload();

    let unsub: RealtimeUnsubscribe | null = null;
    pb.collection('tags')
      .subscribe('*', (e) => {
        if (cancelled) return;
        const parsed = TagRecordSchema.safeParse(e.record);
        if (!parsed.success) return;
        const tag = parsed.data;
        setByProject((prev) => {
          const list = prev[tag.project] ?? [];
          const idx = list.findIndex((t) => t.id === tag.id);
          let nextList: TagRecord[];
          if (e.action === 'delete') {
            if (idx === -1) return prev;
            nextList = list.filter((t) => t.id !== tag.id);
          } else if (idx >= 0) {
            nextList = list.slice();
            nextList[idx] = tag;
          } else {
            nextList = [tag, ...list];
          }
          return { ...prev, [tag.project]: nextList };
        });
      })
      .then((u) => {
        unsub = u as RealtimeUnsubscribe;
        if (cancelled) safeRealtimeUnsubscribe(unsub, 'home tags');
      })
      .catch((err) => console.warn('[home] tags subscribe failed', err));

    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      safeRealtimeUnsubscribe(unsub, 'home tags');
      window.removeEventListener('focus', onFocus);
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

function useHasModelInstalled(): { ready: boolean; hasModel: boolean } {
  const [ready, setReady] = useState(false);
  const [hasModel, setHasModel] = useState(false);

  useEffect(() => {
    if (!isTauri) {
      setReady(true);
      // In the web debug build there's no Tauri to ask, but the canvas
      // also won't actually run a model — so don't gate the click.
      setHasModel(true);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const local = await invoke<LocalModel[]>('models_list_local');
        if (cancelled) return;
        setHasModel(local.length > 0);
        setReady(true);
      } catch {
        if (!cancelled) setReady(true);
      }
    };
    void refresh();

    const onProgress = () => void refresh();
    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen('model-download-progress', onProgress).then((u) => {
        if (cancelled) u();
        else unlisten = u;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { ready, hasModel };
}

export function Home() {
  const state = useProjects();
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>('projects');
  const [forcedModelsView, setForcedModelsView] = useState(false);
  const itemCounts = useItemCounts();
  const tagsByProject = useProjectTags();
  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  // Apply the persisted theme so light/dark stays in sync with the
  // canvas window. Settings are global (localStorage), so the same key
  // resolves on Home and Canvas.
  useAppliedTheme(settings.theme);

  const { ready: modelsReady, hasModel } = useHasModelInstalled();

  // First-run + recovery flow: on first mount, if no model is installed,
  // jam the user onto the Models view. Only force *once* — once the
  // user has installed something we let them navigate freely without
  // bouncing them back. `forcedModelsView` is the latch.
  useEffect(() => {
    if (!modelsReady || forcedModelsView) return;
    if (!hasModel) {
      setView('models');
      setForcedModelsView(true);
    }
  }, [modelsReady, hasModel, forcedModelsView]);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const searchGlass = useAutoLiquidGlassFilter({ radius: 999 });

  const projects = state.status === 'ready' ? state.projects : [];

  // Closing the Home window quits the whole app on every platform.
  // Without this, macOS leaves the process alive after the home window
  // dies and focus jumps to a canvas window — confusing UX.
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    onHomeCloseQuit()
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

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.labels.forEach((l) => set.add(l)));
    return Array.from(set).sort();
  }, [projects]);

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

  const activeModelMissing =
    modelsReady && (settings.activeModel == null || !hasModel);
  const projectsDisabledReason = activeModelMissing
    ? 'Install and activate a SAM3 model first (Models tab).'
    : undefined;

  return (
    <div className="home-root">
      <main className="home-content" data-view={view} key={view}>
        {view === 'projects' && (
          <>
            {state.status === 'loading' && <div className="home-empty">Loading…</div>}
            {state.status === 'error' && (
              <div className="home-empty">Failed to load projects: {state.error.message}</div>
            )}
            {state.status === 'ready' && state.projects.length === 0 && (
              <div className="home-empty">
                {activeModelMissing ? (
                  <>
                    <p>No model installed.</p>
                    <button
                      type="button"
                      className="btn btn-md btn-primary"
                      onClick={() => setView('models')}
                    >
                      Open Models
                    </button>
                  </>
                ) : (
                  <>
                    <p>No projects yet.</p>
                    <button
                      type="button"
                      className="btn btn-md btn-primary"
                      onClick={() => setNewOpen(true)}
                    >
                      Create your first project
                    </button>
                  </>
                )}
              </div>
            )}
            {state.status === 'ready' && state.projects.length > 0 && (
              <ProjectGrid
                projects={visible}
                itemCounts={itemCounts}
                tagsByProject={tagsByProject}
                disabledReason={projectsDisabledReason}
              />
            )}
          </>
        )}
        {view === 'models' && (
          <ModelsView
            activeModel={settings.activeModel}
            onSetActiveModel={(name) => updateSetting('activeModel', name)}
            onDownloadFinished={() => {
              // First successful download — flip back to Projects so
              // the user sees their grid the moment a model is ready.
              if (forcedModelsView) setView('projects');
            }}
          />
        )}
      </main>

      <div className="home-titlebar" data-tauri-drag-region aria-hidden />

      <header className="home-toolbar">
        <div className="home-toolbar-left">
          <span className="home-toolbar-brand" aria-hidden>
            <i className="ri-eye-line" />
            <span>NetraRT</span>
          </span>
          <div className="home-view-switch" role="tablist" aria-label="Home views">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'projects'}
              className={`home-view-tab${view === 'projects' ? ' is-active' : ''}`}
              onClick={() => setView('projects')}
            >
              <i className="ri-folder-2-line" aria-hidden /> Projects
              {state.status === 'ready' && state.projects.length > 0 && (
                <span className="home-view-tab-count">{state.projects.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'models'}
              className={`home-view-tab${view === 'models' ? ' is-active' : ''}`}
              onClick={() => setView('models')}
            >
              <i className="ri-cpu-line" aria-hidden /> Models
              {activeModelMissing && (
                <span
                  className="home-view-tab-dot"
                  aria-label="action required"
                  title="No model installed"
                />
              )}
            </button>
          </div>
        </div>

        <div className="home-toolbar-right">
          {view === 'projects' && (
            <button
              type="button"
              className="home-toolbar-btn is-primary"
              onClick={() => setNewOpen(true)}
              disabled={activeModelMissing}
              title={projectsDisabledReason}
            >
              <i className="ri-add-line" aria-hidden /> New project
            </button>
          )}
          <button
            type="button"
            className="home-toolbar-btn is-icon"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ri-settings-3-line" aria-hidden />
          </button>
        </div>
      </header>

      <DownloadChip onClick={() => setView('models')} />

      {view === 'projects' && (
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
      )}

      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSetting}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <DebNotice />
      <div className="home__footer-bar">
        <UpdaterPill />
      </div>
    </div>
  );
}
