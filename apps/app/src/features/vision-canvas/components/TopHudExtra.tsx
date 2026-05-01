import { Sam3VersionBadge } from './Sam3VersionBadge';
import type { ConnState } from '../lib';

type TopHudExtraProps = {
  conn: ConnState;
  sam3Error: string | null;
};

export function TopHudExtra({ conn, sam3Error }: TopHudExtraProps) {
  return (
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
  );
}
