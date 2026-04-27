import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { NodeRecord } from '../features/llm-canvas';

type Props = {
  /** Currently selected node. Parent mounts/unmounts the component to
   *  drive open/close; selecting a different node simply re-renders
   *  with a new `node` prop. */
  node: NodeRecord;
  onClose: () => void;
  /** Optional override slot for the body — defaults to a placeholder. */
  children?: ReactNode;
};

const STORAGE_KEY = 'netrart:llm-canvas:inspector-width:v1';
const MIN_WIDTH = 280;
const SIDE_MARGIN = 12;
const MIN_LEFT_GAP = 64;

const defaultWidth = (): number => {
  if (typeof window === 'undefined') return 480;
  // Half of the viewport on first open.
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
  } catch {
    /* ignore */
  }
};

const clampWidth = (w: number): number => {
  const max =
    typeof window === 'undefined'
      ? w
      : Math.max(MIN_WIDTH, window.innerWidth - SIDE_MARGIN - MIN_LEFT_GAP);
  return Math.max(MIN_WIDTH, Math.min(w, max));
};

// Floating right-side inspector for canvas nodes. Resizable via the
// left-edge drag handle; "expanded" toggle goes full-width and back.
export function NodeInspectorSidebar({ node, onClose, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState<number>(() => clampWidth(readWidth()));
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Persist width changes (debounced via a microtask).
  useEffect(() => {
    if (resizing) return;
    writeWidth(width);
  }, [width, resizing]);

  // Keep width clamped if the viewport shrinks below the saved value.
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
      // Inline `width` only when not expanded — expanded mode uses the
      // full-viewport CSS rule.
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
        {children ?? <NodeIOTable />}
      </div>
    </aside>
  );
}

function NodeIOTable() {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const outputRef = useRef<HTMLTextAreaElement | null>(null);

  // When the user drags one textarea's vertical resize handle, mirror
  // the new height onto the other textarea so the two cells stay
  // visually aligned across the row. We keep the height imperative
  // (no React state) so the native drag stays smooth.
  useLayoutEffect(() => {
    const a = inputRef.current;
    const b = outputRef.current;
    if (!a || !b) return;

    let raf: number | null = null;
    const sync = () => {
      raf = null;
      const aEl = inputRef.current;
      const bEl = outputRef.current;
      if (!aEl || !bEl) return;
      const target = Math.max(aEl.offsetHeight, bEl.offsetHeight);
      if (aEl.offsetHeight !== target) aEl.style.height = `${target}px`;
      if (bEl.offsetHeight !== target) bEl.style.height = `${target}px`;
    };

    const ro = new ResizeObserver(() => {
      if (raf !== null) return;
      raf = requestAnimationFrame(sync);
    });
    ro.observe(a);
    ro.observe(b);
    return () => {
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="node-io-card">
      <div className="node-io-card-glow" aria-hidden />
      <div className="node-io-grid" role="table" aria-label="Step input and output">
        <section className="node-io-section" data-tone="in" role="rowgroup">
          <header className="node-io-section-header" role="row">
            <span className="node-io-th-pill" role="columnheader">
              <span className="node-io-th-glyph" aria-hidden>
                <i className="ri-login-box-line" />
              </span>
              Input
            </span>
          </header>
          <div className="node-io-cell" role="cell">
            <textarea
              ref={inputRef}
              className="node-io-field"
              rows={4}
              placeholder="Describe the input for this step…"
              spellCheck={false}
            />
          </div>
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
          <div className="node-io-cell" role="cell">
            <textarea
              ref={outputRef}
              className="node-io-field"
              rows={4}
              placeholder="Describe the expected output…"
              spellCheck={false}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
