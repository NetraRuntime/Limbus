import { useEffect } from 'react';
import { Canvas } from './Canvas';
import { BootCard } from './components/BootCard';
import { useSettings } from './hooks/useSettings';
import { useAppliedTheme } from './hooks/useAppliedTheme';
import { useProjectKind } from './features/projects';
import { focusHome } from './lib/windows';

type Props = { projectId: string };

export function App({ projectId }: Props) {
  const { settings } = useSettings();
  useAppliedTheme(settings.theme);
  useCanvasBodyClass();

  const kindState = useProjectKind(projectId);

  if (kindState.status === 'loading') {
    return (
      <BootCard
        spinner
        title="Opening project…"
        subtitle="Loading project metadata."
      />
    );
  }
  if (kindState.status === 'error') {
    return (
      <BootCard
        role="alert"
        title="Couldn't open project"
        subtitle={kindState.message}
        action={
          <button
            type="button"
            className="btn btn-md btn-primary"
            onClick={() => void focusHome()}
          >
            Open Home
          </button>
        }
      />
    );
  }
  return <Canvas projectId={projectId} kind={kindState.kind} />;
}

function useCanvasBodyClass(): void {
  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);
}
