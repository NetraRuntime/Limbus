import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InfiniteCanvas,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
} from './InfiniteCanvas';
import {
  ProjectChip,
  DeletedBanner,
  DeleteProjectModal,
  useProject,
  updateProject,
} from './features/projects';
import { SettingsModal } from './components/SettingsModal';
import { SearchPalette } from './components/SearchPalette';
import { useAutoLiquidGlassFilter } from './components/LiquidGlass';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { setCanvasTitle, closeCurrentCanvas, focusHome } from './lib/windows';
import {
  VIEW_PERSIST_DEBOUNCE_MS,
  formatCoord,
  formatZoom,
  getInitialView,
  writeStoredView,
} from './lib/canvasView';
import './App.css';

type Props = {
  projectId: string;
};

// A "step" is the future unit of work on an LLM canvas (a prompt, a
// chain link, a tool call). Until the LLM canvas grows real authoring
// tools, we render an empty list so the search palette still mounts and
// the keyboard shortcut is wired up.
type Step = {
  id: string;
  name: string;
};

export function LlmCanvas({ projectId }: Props) {
  const projectState = useProject(projectId);

  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>(() => {
    const init = getInitialView();
    return { x: init.x ?? 0, y: init.y ?? 0, scale: init.scale ?? 1 };
  });
  const [cursor, setCursor] = useState<{ worldX: number; worldY: number } | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  const { settings, update: updateSetting, reset: resetSettings } = useSettings();
  useAppliedTheme(settings.theme);

  // Steps will eventually be backed by PocketBase. Empty for now —
  // search palette still works, just shows the empty state.
  const steps = useMemo<Step[]>(() => [], []);

  const wordmarkGlass = useAutoLiquidGlassFilter({ radius: 10 });
  const settingsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const searchPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const statusPillGlass = useAutoLiquidGlassFilter({ radius: 999 });
  const controlsPillGlass = useAutoLiquidGlassFilter({ radius: 999 });

  useEffect(() => {
    if (projectState.status !== 'ready') return;
    void setCanvasTitle(projectId, projectState.project.name);
  }, [projectId, projectState]);

  // Persist view changes (debounced), matching the vision Canvas behavior.
  useEffect(() => {
    const t = window.setTimeout(() => writeStoredView(view), VIEW_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  // Cmd+K / Ctrl+K opens the step search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleChange = useCallback((next: View) => setView(next), []);
  const handlePointerWorld = useCallback(
    (p: (WorldPoint & { screenX: number; screenY: number }) | null) => {
      if (!p) {
        setCursor(null);
        return;
      }
      setCursor({ worldX: p.worldX, worldY: p.worldY });
    },
    [],
  );

  const matchStep = useCallback(
    (s: Step, q: string) => s.name.toLowerCase().includes(q),
    [],
  );

  if (projectState.status === 'deleted') return <DeletedBanner />;

  return (
    <>
      <div className="canvas-titlebar" data-tauri-drag-region aria-hidden />
      <InfiniteCanvas
        ref={canvasRef}
        initial={getInitialView()}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        zoomSensitivity={settings.zoomSensitivity}
        panSpeed={settings.panSpeed}
      />

      <div className="empty-state" aria-hidden>
        <div className="empty-state-inner">
          <div className="empty-eyebrow">LLM project</div>
          <div className="empty-title">
            Chat & prompt <span className="accent">coming soon</span>
          </div>
          <div className="empty-sub">
            This canvas is set up for language models. Steps you build will live here.
          </div>
        </div>
      </div>

      <div className="hud hud-top-left">
        {wordmarkGlass.filterSvg}
        <div
          ref={wordmarkGlass.ref}
          className="wordmark is-liquid-glass"
          aria-label="NetraRT"
          style={wordmarkGlass.style}
        >
          <button
            type="button"
            className="wordmark-home"
            aria-label="Back to Home"
            title="Back to Home"
            onClick={() => void focusHome()}
          >
            <i className="ri-home-2-line wordmark-home-icon" aria-hidden />
            <span className="wordmark-glyph">NetraRT</span>
          </button>
          {projectState.status === 'ready' && (
            <>
              <span className="wordmark-divider" aria-hidden />
              <ProjectChip project={projectState.project} />
            </>
          )}
        </div>
      </div>

      <div className="hud hud-bottom-center">
        {searchPillGlass.filterSvg}
        {statusPillGlass.filterSvg}
        {controlsPillGlass.filterSvg}
        <div
          ref={searchPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Search"
          style={searchPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Search steps (⌘K / Ctrl+K)"
            title="Search steps (⌘K)"
            onClick={() => setSearchOpen(true)}
          >
            <i className="ri-search-line" aria-hidden />
          </button>
        </div>

        <div
          ref={statusPillGlass.ref}
          className="status-pill is-liquid-glass"
          style={statusPillGlass.style}
        >
          <span className="status-label">Zoom</span>
          <span className="status-value">{formatZoom(view.scale)}</span>
          <span className="status-sep" aria-hidden />
          <span className="status-label">X</span>
          <span className="status-value">{formatCoord(cursor?.worldX)}</span>
          <span className="status-label">Y</span>
          <span className="status-value">{formatCoord(cursor?.worldY)}</span>
        </div>

        <div
          ref={controlsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="Canvas controls"
          style={controlsPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Reset view"
            onClick={() => canvasRef.current?.reset()}
          >
            Reset
          </button>
          <button
            className="btn-ghost"
            type="button"
            aria-label="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.4)}
          >
            +
          </button>
        </div>
      </div>

      <div className="hud hud-top-right">
        {settingsPillGlass.filterSvg}
        <div
          ref={settingsPillGlass.ref}
          className="btn-cluster is-liquid-glass"
          role="group"
          aria-label="App controls"
          style={settingsPillGlass.style}
        >
          <button
            className="btn-ghost"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ri-settings-3-line" aria-hidden />
          </button>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSetting}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
        project={projectState.status === 'ready' ? projectState.project : undefined}
        onRenameProject={
          projectState.status === 'ready'
            ? async (name) => {
                await updateProject(projectState.project.id, { name });
              }
            : undefined
        }
        onDeleteProject={() => {
          setSettingsOpen(false);
          setDeleteProjectOpen(true);
        }}
      />

      {deleteProjectOpen && projectState.status === 'ready' && (
        <DeleteProjectModal
          project={projectState.project}
          onClose={() => {
            setDeleteProjectOpen(false);
            setSettingsOpen(true);
          }}
          onDeleted={() => void closeCurrentCanvas()}
        />
      )}

      <SearchPalette
        open={searchOpen}
        items={steps}
        onSelect={() => setSearchOpen(false)}
        onClose={() => setSearchOpen(false)}
        match={matchStep}
        placeholder="Search step…"
        ariaLabel="Search steps"
        emptyText="No matches"
        emptyWhenNoItemsText="No steps yet"
        renderItem={(s) => (
          <>
            <i className="ri-list-check-2 search-result-icon" aria-hidden />
            <span className="search-result-name">{s.name}</span>
          </>
        )}
      />
    </>
  );
}
