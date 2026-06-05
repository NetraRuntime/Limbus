import type { ReactNode } from 'react';
import { ProjectChip, type ProjectRecord } from '../../projects';
import { focusHome } from '../../../lib/windows';

type GlassRender = {
  filterSvg: React.ReactNode;
  ref: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
};

type Props = {
  glass: GlassRender;
  project: ProjectRecord | null;
  /** Extra trailing content (e.g. connection dot, version badge). */
  extra?: ReactNode;
};

export function CanvasTopHud({ glass, project, extra }: Props) {
  return (
    <div className="hud hud-top-left">
      {glass.filterSvg}
      <div
        ref={glass.ref}
        className="wordmark is-liquid-glass"
        aria-label="Netra Limbus"
        style={glass.style}
      >
        <button
          type="button"
          className="wordmark-home"
          aria-label="Back to Home"
          title="Back to Home"
          onClick={() => void focusHome()}
        >
          <i className="ri-home-2-line wordmark-home-icon" aria-hidden />
          <span className="wordmark-glyph">Netra Limbus</span>
        </button>
        {project && (
          <>
            <span className="wordmark-divider" aria-hidden />
            <ProjectChip project={project} />
          </>
        )}
        {extra}
      </div>
    </div>
  );
}
