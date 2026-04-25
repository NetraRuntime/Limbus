import { useState } from 'react';
import { useProjects } from '../api/useProjects';
import { ProjectGrid } from './ProjectGrid';
import { NewProjectModal } from './NewProjectModal';
import '../Home.css';

export function Home() {
  const state = useProjects();
  const [newOpen, setNewOpen] = useState(false);

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
          <ProjectGrid projects={state.projects} />
        )}
      </main>
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}
