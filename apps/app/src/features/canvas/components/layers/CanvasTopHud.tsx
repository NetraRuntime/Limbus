import { ProjectChip, type ProjectRecord } from '../../../projects';
import { Sam3VersionBadge } from '../../../../components/Sam3VersionBadge';
import { focusHome } from '../../../../lib/windows';
import type { ConnState } from '../../lib';

type GlassRender = {
  filterSvg: React.ReactNode;
  ref: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
};

type Props = {
  glass: GlassRender;
  project: ProjectRecord | null;
  conn: ConnState;
  sam3Error: string | null;
};

export function CanvasTopHud({ glass, project, conn, sam3Error }: Props) {
  return (
    <div className="hud hud-top-left">
      {glass.filterSvg}
      <div
        ref={glass.ref}
        className="wordmark is-liquid-glass"
        aria-label="NetraRT"
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
          <span className="wordmark-glyph">NetraRT</span>
        </button>
        {project && (
          <>
            <span className="wordmark-divider" aria-hidden />
            <ProjectChip project={project} />
          </>
        )}
        <span className="wordmark-divider" aria-hidden />
        <span
          className={`conn-dot conn-${conn}`}
          aria-label={`connection ${conn}`}
        />
        <span className="wordmark-tag">{conn}</span>
        <span className="wordmark-divider" aria-hidden />
        {sam3Error ? (
          <span
            className="wordmark-tag sam3-error-tag"
            role="alert"
            title={sam3Error}
          >
            SAM3 Error
          </span>
        ) : (
          <Sam3VersionBadge />
        )}
      </div>
    </div>
  );
}
