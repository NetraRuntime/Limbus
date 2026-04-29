import { CanvasTopHud as BaseCanvasTopHud } from '../../../canvas-core';
import type { ProjectRecord } from '../../../projects';
import { Sam3VersionBadge } from '../Sam3VersionBadge';
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
    <BaseCanvasTopHud
      glass={glass}
      project={project}
      extra={
        <>
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
        </>
      }
    />
  );
}
