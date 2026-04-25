import {
  type LoadState,
  type ModelRow,
  type RowStatus,
  useModelsManager,
} from '../api/useModelsManager';

const HF_REPO_URL = 'https://huggingface.co/Rifky/SAM3';

function formatBytes(n: number): string {
  if (n === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

type Props = {
  activeModel: string | null;
  onSetActiveModel: (name: string | null) => void;
  onDownloadFinished?: (name: string) => void;
};

// Top-level Home view for managing SAM3 models. Replaces the old nested
// Settings → Models tab. Renders a hero CTA when nothing is installed
// (first-run flow) and falls back to a row list once the user has at
// least one model.
export function ModelsView({ activeModel, onSetActiveModel, onDownloadFinished }: Props) {
  const { rows, loadState, installedCount, download, cancel, remove, use } =
    useModelsManager({ activeModel, onSetActiveModel, onDownloadFinished });

  const featured = rows.find((r) => !r.installed) ?? rows[0];
  const showHero = installedCount === 0 && Boolean(featured);

  return (
    <div className="models-view">
      <header className="models-view-head">
        <h1>Models</h1>
        <a
          className="models-source"
          href={HF_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <i className="ri-external-link-line" aria-hidden /> Rifky/SAM3
        </a>
      </header>

      <Body
        rows={rows}
        loadState={loadState}
        showHero={showHero}
        featured={featured}
        onDownload={(row) => void download(row)}
        onCancel={(name) => void cancel(name)}
        onRemove={(name) => void remove(name)}
        onUse={(name) => void use(name)}
      />
    </div>
  );
}

type BodyProps = {
  rows: ModelRow[];
  loadState: LoadState;
  showHero: boolean;
  featured: ModelRow | undefined;
  onDownload: (row: ModelRow) => void;
  onCancel: (name: string) => void;
  onRemove: (name: string) => void;
  onUse: (name: string) => void;
};

function Body({
  rows,
  loadState,
  showHero,
  featured,
  onDownload,
  onCancel,
  onRemove,
  onUse,
}: BodyProps) {
  if (loadState.phase === 'loading') {
    return <div className="models-empty">Loading model catalog…</div>;
  }
  if (loadState.phase === 'error') {
    return (
      <div className="models-empty is-error" role="alert">
        {loadState.message}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="models-empty">
        No models in the repo right now. Check back later.
      </div>
    );
  }

  return (
    <>
      {showHero && featured && (
        <HeroCard
          row={featured}
          onDownload={() => onDownload(featured)}
          onCancel={() => onCancel(featured.name)}
        />
      )}

      <ul className="models-list">
        {rows.map((row, i) => (
          <ModelListRow
            key={row.name}
            row={row}
            index={i}
            onDownload={() => onDownload(row)}
            onCancel={() => onCancel(row.name)}
            onRemove={() => onRemove(row.name)}
            onUse={() => onUse(row.name)}
          />
        ))}
      </ul>
    </>
  );
}

type HeroProps = {
  row: ModelRow;
  onDownload: () => void;
  onCancel: () => void;
};

function HeroCard({ row, onDownload, onCancel }: HeroProps) {
  const downloading = row.status.kind === 'downloading';
  return (
    <section className="models-hero" aria-labelledby="models-hero-title">
      <div className="models-hero-glow" aria-hidden />
      <div className="models-hero-icon" aria-hidden>
        <i className="ri-sparkling-2-line" />
      </div>
      <div className="models-hero-text">
        <h2 id="models-hero-title">Install your first model</h2>
        <p>
          <code>{row.name}</code> · {formatBytes(row.size)}
        </p>
        {downloading && row.status.kind === 'downloading' && (
          <ProgressBar status={row.status} />
        )}
        {row.status.kind === 'downloading' ? (
          <div className="models-hero-actions">
            <span className="models-row-meta">
              <StatusLabel status={row.status} fallbackSize={row.size} />
            </span>
            <button type="button" className="btn btn-md" onClick={onCancel}>
              <i className="ri-close-line" aria-hidden /> Cancel
            </button>
          </div>
        ) : (
          <div className="models-hero-actions">
            <button
              type="button"
              className="btn btn-md btn-primary"
              onClick={onDownload}
            >
              <i className="ri-download-line" aria-hidden /> Download
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

type RowProps = {
  row: ModelRow;
  index: number;
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onUse: () => void;
};

function ModelListRow({ row, index, onDownload, onCancel, onRemove, onUse }: RowProps) {
  const status = row.status;
  const installedNotActive = row.installed && !row.active && status.kind !== 'downloading';
  return (
    <li
      className={`models-row${row.installed ? ' is-installed' : ''}${row.active ? ' is-active' : ''}`}
      style={{ '--stagger-i': index } as React.CSSProperties}
    >
      <div className="models-row-main">
        <div className="models-row-icon" aria-hidden>
          <i
            className={
              row.active
                ? 'ri-checkbox-circle-fill'
                : row.installed
                  ? 'ri-checkbox-circle-line'
                  : 'ri-cloud-line'
            }
          />
        </div>
        <div className="models-row-text">
          <div className="models-row-name">
            {row.name}
            {row.active && (
              <span className="models-active-pill" aria-label="active model">
                Active
              </span>
            )}
          </div>
          <div className="models-row-meta">
            <StatusLabel status={status} fallbackSize={row.size} />
          </div>
        </div>
        <div className="models-row-actions">
          {status.kind === 'downloading' ? (
            <button type="button" className="btn-ghost models-btn" onClick={onCancel}>
              <i className="ri-close-line" aria-hidden /> Cancel
            </button>
          ) : (
            <>
              {installedNotActive && (
                <button
                  type="button"
                  className="btn-ghost models-btn is-primary"
                  onClick={onUse}
                  aria-label={`Use ${row.name}`}
                >
                  <i className="ri-play-circle-line" aria-hidden /> Use
                </button>
              )}
              {row.installed && (
                <button
                  type="button"
                  className="btn-ghost models-btn is-danger"
                  onClick={onRemove}
                  aria-label={`Delete ${row.name}`}
                >
                  <i className="ri-delete-bin-line" aria-hidden /> Remove
                </button>
              )}
              {!row.installed && row.url && (
                <button
                  type="button"
                  className="btn-ghost models-btn is-primary"
                  onClick={onDownload}
                >
                  <i className="ri-download-line" aria-hidden /> Download
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {status.kind === 'downloading' && <ProgressBar status={status} />}
      {status.kind === 'error' && (
        <p className="models-row-error" role="alert">
          {status.message}
        </p>
      )}
    </li>
  );
}

function StatusLabel({ status, fallbackSize }: { status: RowStatus; fallbackSize: number }) {
  if (status.kind === 'downloading') {
    const pct = status.total > 0 ? Math.floor((status.downloaded / status.total) * 100) : null;
    if (status.total > 0) {
      return (
        <span>
          {formatBytes(status.downloaded)} / {formatBytes(status.total)}
          {pct !== null ? ` · ${pct}%` : ''}
        </span>
      );
    }
    return <span>{formatBytes(status.downloaded)}…</span>;
  }
  if (status.kind === 'error') {
    return <span className="models-row-meta-error">Error</span>;
  }
  return <span>{formatBytes(fallbackSize)}</span>;
}

function ProgressBar({ status }: { status: Extract<RowStatus, { kind: 'downloading' }> }) {
  const indeterminate = status.total === 0;
  const pct = indeterminate
    ? null
    : Math.max(0, Math.min(100, (status.downloaded / status.total) * 100));
  return (
    <div
      className={`models-progress${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <div
        className="models-progress-bar"
        style={pct !== null ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
