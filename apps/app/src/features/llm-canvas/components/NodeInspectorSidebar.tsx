import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { NodeExample, NodeRecord } from '../types/canvas';

type Props = {
  node: NodeRecord;
  onClose: () => void;
  /** Parent owns debounce + persistence. */
  onPatch?: (id: string, patch: { examples?: NodeExample[] }) => void;
  children?: ReactNode;
};

const STORAGE_KEY = 'netrart:llm-canvas:inspector-width:v1';
const MIN_WIDTH = 280;
const SIDE_MARGIN = 12;
const MIN_LEFT_GAP = 64;

const defaultWidth = (): number => {
  if (typeof window === 'undefined') return 480;
  return Math.round(window.innerWidth / 2);
};

const readWidth = (): number => {
  if (typeof localStorage === 'undefined') return defaultWidth();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultWidth();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= MIN_WIDTH ? parsed : defaultWidth();
};

const writeWidth = (w: number) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(w));
  } catch {}
};

const clampWidth = (w: number): number => {
  const max =
    typeof window === 'undefined'
      ? w
      : Math.max(MIN_WIDTH, window.innerWidth - SIDE_MARGIN - MIN_LEFT_GAP);
  return Math.max(MIN_WIDTH, Math.min(w, max));
};

export function NodeInspectorSidebar({ node, onClose, onPatch, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState<number>(() => clampWidth(readWidth()));
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (resizing) return;
    writeWidth(width);
  }, [width, resizing]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setExpanded(false);
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const next = clampWidth(window.innerWidth - ev.clientX - SIDE_MARGIN);
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <aside
      className={`node-inspector${expanded ? ' is-expanded' : ''}${
        resizing ? ' is-resizing' : ''
      }`}
      role="complementary"
      aria-label={`${node.name} details`}
      style={expanded ? undefined : { width }}
    >
      <div
        className="node-inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        onPointerDown={startResize}
      />
      <header className="node-inspector-header">
        <button
          type="button"
          className="node-inspector-icon-btn"
          aria-label={expanded ? 'Collapse' : 'Expand to full width'}
          title={expanded ? 'Collapse' : 'Expand to full width'}
          onClick={() => setExpanded((v) => !v)}
        >
          <i
            className={expanded ? 'ri-contract-right-line' : 'ri-expand-left-line'}
            aria-hidden
          />
        </button>
        <span className="node-inspector-title" title={node.name}>
          {node.name}
        </span>
        <button
          type="button"
          className="node-inspector-icon-btn"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <i className="ri-close-line" aria-hidden />
        </button>
      </header>
      <div className="node-inspector-body">
        {children ?? <NodeIOTable node={node} onPatch={onPatch} />}
      </div>
    </aside>
  );
}

type IOTableProps = {
  node: NodeRecord;
  onPatch?: (id: string, patch: { examples?: NodeExample[] }) => void;
};

function NodeIOTable({ node, onPatch }: IOTableProps) {
  const rows: NodeExample[] =
    node.examples.length > 0 ? node.examples : [{ input: '', output: '' }];

  const updateRow = (
    rowIdx: number,
    patch: { input?: string; output?: string },
  ) => {
    const next = node.examples.length > 0 ? node.examples.slice() : [];
    while (next.length <= rowIdx) next.push({ input: '', output: '' });
    next[rowIdx] = { ...next[rowIdx]!, ...patch };
    onPatch?.(node.id, { examples: next });
  };

  const addRow = () => {
    const next: NodeExample[] = [
      ...(node.examples.length > 0
        ? node.examples
        : [{ input: '', output: '' }]),
      { input: '', output: '' },
    ];
    onPatch?.(node.id, { examples: next });
  };

  const removeRow = (rowIdx: number) => {
    const base = node.examples.length > 0 ? node.examples : [{ input: '', output: '' }];
    const next = base.filter((_, i) => i !== rowIdx);
    onPatch?.(node.id, { examples: next });
  };

  return (
    <div className="node-io-card">
      <div className="node-io-card-glow" aria-hidden />
      <div
        className="node-io-grid"
        role="table"
        aria-label="Step input and output examples"
      >
        <section className="node-io-section" data-tone="in" role="rowgroup">
          <header className="node-io-section-header" role="row">
            <span className="node-io-th-pill" role="columnheader">
              <span className="node-io-th-glyph" aria-hidden>
                <i className="ri-login-box-line" />
              </span>
              Input
            </span>
          </header>
          {rows.map((row, idx) => (
            <NodeIOCell
              key={`in-${idx}`}
              column="input"
              row={row}
              rowIdx={idx}
              rowCount={rows.length}
              onChange={(v) => updateRow(idx, { input: v })}
              onRemove={() => removeRow(idx)}
            />
          ))}
        </section>
        <section className="node-io-section" data-tone="out" role="rowgroup">
          <header className="node-io-section-header" role="row">
            <span className="node-io-th-pill" role="columnheader">
              <span className="node-io-th-glyph" aria-hidden>
                <i className="ri-logout-box-r-line" />
              </span>
              Output
            </span>
          </header>
          {rows.map((row, idx) => (
            <NodeIOCell
              key={`out-${idx}`}
              column="output"
              row={row}
              rowIdx={idx}
              rowCount={rows.length}
              onChange={(v) => updateRow(idx, { output: v })}
              onRemove={() => removeRow(idx)}
            />
          ))}
        </section>
      </div>
      <div className="node-io-actions">
        <button
          type="button"
          className="node-io-add-btn"
          onClick={addRow}
          aria-label="Add a new input/output row"
        >
          <i className="ri-add-line" aria-hidden />
          <span>Add row</span>
        </button>
      </div>
    </div>
  );
}

type NodeIOCellProps = {
  column: 'input' | 'output';
  row: NodeExample;
  rowIdx: number;
  rowCount: number;
  onChange: (next: string) => void;
  onRemove: () => void;
};

function NodeIOCell({ column, row, rowIdx, rowCount, onChange, onRemove }: NodeIOCellProps) {
  const placeholder =
    column === 'input'
      ? 'Describe the input for this step…'
      : 'Describe the expected output…';
  const value = column === 'input' ? row.input : row.output;
  return (
    <div className="node-io-cell" role="cell" data-row={rowIdx}>
      <textarea
        className="node-io-field"
        rows={3}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {column === 'input' && rowCount > 1 && (
        <button
          type="button"
          className="node-io-row-remove"
          onClick={onRemove}
          aria-label={`Remove row ${rowIdx + 1}`}
          title="Remove row"
        >
          <i className="ri-delete-bin-line" aria-hidden />
        </button>
      )}
    </div>
  );
}
