import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  ConversationMessage,
  NodeExample,
  NodeRecord,
} from '../types/canvas';
import { ImportError, parseConversationsFile } from '../lib/importExamples';

export type FocusedExample = {
  idx: number;
  token: number;
};

export type ExamplesPatchOptions = {
  history?: { label: string; coalesceKey?: string };
};

export type ExamplesPatchFn = (
  id: string,
  patch: { examples?: NodeExample[] },
  opts?: ExamplesPatchOptions,
) => void;

type Props = {
  node: NodeRecord;
  onClose: () => void;
  onPatch?: ExamplesPatchFn;
  focusedExample?: FocusedExample | null;
  children?: ReactNode;
};

const STORAGE_KEY = 'netra-limbus:llm-canvas:inspector-width:v1';
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

export function NodeInspectorSidebar({
  node,
  onClose,
  onPatch,
  focusedExample,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState<number>(() => clampWidth(readWidth()));
  const [resizing, setResizing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const focusOnImportRef = useRef<((idx: number) => void) | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const importFile = useCallback(
    (file: File) => {
      if (!onPatch) return;
      setImportError(null);
      file
        .text()
        .then((text) => {
          try {
            const result = parseConversationsFile(file.name, text);
            const imported = result.examples;
            if (imported.length === 0) {
              setImportError('No conversations found in file.');
              return;
            }
            const stored = node.examples;
            const base =
              stored.length === 1 && stored[0]!.messages.length === 0
                ? []
                : stored.slice();
            const next = [...base, ...imported];
            const label =
              imported.length === 1
                ? 'Import conversation'
                : `Import ${imported.length} conversations`;
            onPatch(node.id, { examples: next }, { history: { label } });
            focusOnImportRef.current?.(next.length - imported.length);
          } catch (err) {
            if (err instanceof ImportError) setImportError(err.message);
            else
              setImportError(
                err instanceof Error ? err.message : 'Failed to parse file.',
              );
          }
        })
        .catch((err: unknown) => {
          setImportError(err instanceof Error ? err.message : 'Failed to read file.');
        });
    },
    [node.id, node.examples, onPatch],
  );

  const hasFiles = (e: ReactDragEvent<HTMLElement>) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const handleDragEnter = (e: ReactDragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (e: ReactDragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  };

  const handleDrop = (e: ReactDragEvent<HTMLElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) importFile(file);
  };

  useEffect(() => {
    if (resizing) return;
    writeWidth(width);
  }, [width, resizing]);

  // Suppress the browser's default file-drop handler at the document level so
  // dropping outside the inspector doesn't navigate the webview to the file.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

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
      }${dragActive ? ' is-drag-target' : ''}`}
      aria-label={`${node.name} details`}
      style={expanded ? undefined : { width }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        {children ?? (
          <NodeConversationList
            node={node}
            onPatch={onPatch}
            focusedExample={focusedExample ?? null}
            importError={importError}
            onClearImportError={() => setImportError(null)}
            registerFocusOnImport={(fn) => {
              focusOnImportRef.current = fn;
            }}
          />
        )}
      </div>
      {dragActive && (
        <div className="node-inspector-drop-overlay" aria-hidden>
          <i className="ri-upload-cloud-2-line" aria-hidden />
          <span>Drop ShareGPT, ChatML, CSV, or text file</span>
        </div>
      )}
    </aside>
  );
}

type ListProps = {
  node: NodeRecord;
  onPatch?: ExamplesPatchFn;
  focusedExample: FocusedExample | null;
  importError: string | null;
  onClearImportError: () => void;
  registerFocusOnImport: (fn: (idx: number) => void) => void;
};

type Caret = 'start' | 'end';

type PendingNav = {
  exampleIdx: number;
  slotIdx: number;
  caret: Caret;
};

const emptyExample = (): NodeExample => ({ messages: [] });

/** Number of UI slots in an example (system bubble + non-system messages). */
const slotCount = (ex: NodeExample): number => {
  const hasSys = ex.messages[0]?.role === 'system';
  return (hasSys ? ex.messages.length - 1 : ex.messages.length) + 1;
};

/** Convert a slot index into the underlying messages array index. Returns
 *  -1 when the slot points to the virtual (unmaterialized) system bubble. */
const slotToMsgIdx = (ex: NodeExample, slotIdx: number): number => {
  const hasSys = ex.messages[0]?.role === 'system';
  if (slotIdx === 0) return hasSys ? 0 : -1;
  return hasSys ? slotIdx : slotIdx - 1;
};

function NodeConversationList({
  node,
  onPatch,
  focusedExample,
  importError,
  onClearImportError,
  registerFocusOnImport,
}: ListProps) {
  const examples: NodeExample[] =
    node.examples.length > 0 ? node.examples : [emptyExample()];

  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  const [openSet, setOpenSet] = useState<Set<number>>(
    () => new Set([focusedExample ? focusedExample.idx : 0]),
  );
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);

  // A search-driven focus opens the matching row and scrolls to it.
  useEffect(() => {
    if (!focusedExample) return;
    setOpenSet((s) => {
      if (s.has(focusedExample.idx)) return s;
      const n = new Set(s);
      n.add(focusedExample.idx);
      return n;
    });
  }, [focusedExample]);

  // Apply a pending focus once the target textarea is mounted in the DOM.
  useEffect(() => {
    if (!pendingNav) return;
    const key = `${pendingNav.exampleIdx}:${pendingNav.slotIdx}`;
    const el = inputRefs.current.get(key);
    if (!el) return;
    el.focus({ preventScroll: true });
    const pos = pendingNav.caret === 'end' ? el.value.length : 0;
    el.setSelectionRange(pos, pos);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingNav(null);
  }, [pendingNav, node.examples]);

  const commit = (next: NodeExample[], opts?: ExamplesPatchOptions) =>
    onPatch?.(node.id, { examples: next }, opts);

  const updateExample = (
    idx: number,
    patch: NodeExample,
    opts?: ExamplesPatchOptions,
  ) => {
    const base = node.examples.length > 0 ? node.examples.slice() : [emptyExample()];
    while (base.length <= idx) base.push(emptyExample());
    base[idx] = patch;
    commit(base, opts);
  };

  const addExample = () => {
    const base = node.examples.length > 0 ? node.examples.slice() : [emptyExample()];
    base.push(emptyExample());
    commit(base, { history: { label: 'Add conversation example' } });
  };

  useEffect(() => {
    registerFocusOnImport((idx) => {
      setOpenSet(() => new Set([idx]));
    });
  }, [registerFocusOnImport]);

  const removeExample = (idx: number) => {
    const base = node.examples.length > 0 ? node.examples : [emptyExample()];
    const next = base.filter((_, i) => i !== idx);
    commit(next, { history: { label: 'Remove conversation example' } });
    setOpenSet((s) => {
      const n = new Set<number>();
      for (const i of s) {
        if (i === idx) continue;
        n.add(i > idx ? i - 1 : i);
      }
      return n;
    });
  };

  const setOpen = useCallback((idx: number, open: boolean) => {
    setOpenSet((s) => {
      const has = s.has(idx);
      if (has === open) return s;
      const n = new Set(s);
      if (open) n.add(idx);
      else n.delete(idx);
      return n;
    });
  }, []);

  const toggleOpen = useCallback((idx: number) => {
    setOpenSet((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }, []);

  const registerInput = useCallback(
    (exIdx: number, slotIdx: number, el: HTMLTextAreaElement | null) => {
      const key = `${exIdx}:${slotIdx}`;
      if (el) inputRefs.current.set(key, el);
      else inputRefs.current.delete(key);
    },
    [],
  );

  const requestFocus = useCallback(
    (exIdx: number, slotIdx: number, caret: Caret) => {
      setPendingNav({ exampleIdx: exIdx, slotIdx, caret });
    },
    [],
  );

  const navigatePrev = (exIdx: number, slotIdx: number) => {
    if (slotIdx > 0) {
      requestFocus(exIdx, slotIdx - 1, 'end');
      return;
    }
    if (exIdx > 0) {
      const prevIdx = exIdx - 1;
      setOpen(prevIdx, true);
      const lastSlot = slotCount(examples[prevIdx]!) - 1;
      requestFocus(prevIdx, lastSlot, 'end');
    }
  };

  const navigateNext = (exIdx: number, slotIdx: number) => {
    const lastSlot = slotCount(examples[exIdx]!) - 1;
    if (slotIdx < lastSlot) {
      requestFocus(exIdx, slotIdx + 1, 'start');
      return;
    }
    if (exIdx < examples.length - 1) {
      const nextIdx = exIdx + 1;
      setOpen(nextIdx, true);
      requestFocus(nextIdx, 0, 'start');
    }
  };

  const addTurnAfter = (exIdx: number, slotIdx: number) => {
    const ex = examples[exIdx]!;
    const msgIdx = slotToMsgIdx(ex, slotIdx);
    // The new turn alternates with the focused turn so inserts in the
    // middle (e.g., between two user turns) yield the right role.
    const focusedRole: ConversationMessage['role'] =
      msgIdx < 0 ? 'system' : ex.messages[msgIdx]!.role;
    const newRole: ConversationMessage['role'] =
      focusedRole === 'user' ? 'assistant' : 'user';
    const insertAt = msgIdx < 0 ? 0 : msgIdx + 1;
    const newMessages = [...ex.messages];
    newMessages.splice(insertAt, 0, { role: newRole, content: '' });
    updateExample(exIdx, { messages: newMessages }, {
      history: { label: 'Add turn' },
    });
    requestFocus(exIdx, slotIdx + 1, 'end');
  };

  const handleBackspaceEmpty = (exIdx: number, slotIdx: number) => {
    const ex = examples[exIdx]!;
    const msgIdx = slotToMsgIdx(ex, slotIdx);
    if (msgIdx < 0) return; // virtual system slot — nothing to remove
    const remaining = ex.messages.filter((_, i) => i !== msgIdx);
    updateExample(exIdx, { messages: remaining }, {
      history: { label: 'Remove turn' },
    });
    if (slotIdx > 0) {
      requestFocus(exIdx, slotIdx - 1, 'end');
    } else if (exIdx > 0) {
      const prevIdx = exIdx - 1;
      setOpen(prevIdx, true);
      const lastSlot = slotCount(examples[prevIdx]!) - 1;
      requestFocus(prevIdx, lastSlot, 'end');
    } else if (slotCount({ messages: remaining }) > 1) {
      // First example, first turn deleted, but other turns remain — focus
      // the new top non-system turn (slot 1 in the post-delete layout).
      requestFocus(exIdx, 1, 'end');
    }
  };

  return (
    <div className="node-convo-card">
      <ul className="node-convo-list" aria-label="Conversation examples">
        {examples.map((ex, idx) => (
          <ConversationRow
            key={idx}
            index={idx}
            example={ex}
            canRemove={examples.length > 1}
            open={openSet.has(idx)}
            focusedExample={focusedExample}
            onToggleOpen={() => toggleOpen(idx)}
            onChange={(next, opts) => updateExample(idx, next, opts)}
            onRemove={() => removeExample(idx)}
            onAddTurnAfter={(slotIdx) => addTurnAfter(idx, slotIdx)}
            onBackspaceEmpty={(slotIdx) => handleBackspaceEmpty(idx, slotIdx)}
            onNavigatePrev={(slotIdx) => navigatePrev(idx, slotIdx)}
            onNavigateNext={(slotIdx) => navigateNext(idx, slotIdx)}
            registerInput={(slotIdx, el) => registerInput(idx, slotIdx, el)}
          />
        ))}
      </ul>
      <div className="node-convo-actions">
        <button
          type="button"
          className="node-convo-add-btn"
          onClick={addExample}
          aria-label="Add a new conversation example"
        >
          <i className="ri-add-line" aria-hidden />
          <span>Add conversation</span>
        </button>
      </div>
      {importError && (
        <div className="node-convo-import-error" role="alert">
          <i className="ri-error-warning-line" aria-hidden />
          <span>{importError}</span>
          <button
            type="button"
            className="node-convo-import-error-close"
            onClick={onClearImportError}
            aria-label="Dismiss"
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

type RowProps = {
  index: number;
  example: NodeExample;
  canRemove: boolean;
  open: boolean;
  focusedExample: FocusedExample | null;
  onToggleOpen: () => void;
  onChange: (next: NodeExample, opts?: ExamplesPatchOptions) => void;
  onRemove: () => void;
  onAddTurnAfter: (slotIdx: number) => void;
  onBackspaceEmpty: (slotIdx: number) => void;
  onNavigatePrev: (slotIdx: number) => void;
  onNavigateNext: (slotIdx: number) => void;
  registerInput: (slotIdx: number, el: HTMLTextAreaElement | null) => void;
};

function ConversationRow({
  index,
  example,
  canRemove,
  open,
  focusedExample,
  onToggleOpen,
  onChange,
  onRemove,
  onAddTurnAfter,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
  registerInput,
}: RowProps) {
  const rowRef = useRef<HTMLLIElement>(null);
  const lastFocusToken = useRef<number | null>(null);

  useEffect(() => {
    if (!focusedExample || focusedExample.idx !== index) return;
    if (lastFocusToken.current === focusedExample.token) return;
    lastFocusToken.current = focusedExample.token;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusedExample, index]);

  const messages = example.messages;
  const hasSystem = messages[0]?.role === 'system';
  const turnCount = hasSystem ? messages.length - 1 : messages.length;
  const firstUser = messages.find((m) => m.role === 'user');
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const userText = firstUser?.content?.trim() ?? '';
  const assistantText = lastAssistant?.content?.trim() ?? '';
  const previewParts: string[] = [];
  if (userText) previewParts.push(userText);
  if (assistantText) previewParts.push(assistantText);
  const previewText = previewParts.join(' → ');

  // Coalesce-key per slot folds rapid keystrokes into a single undo entry.
  // System edits — whether the row already has a system message or is being
  // materialized — share key `:system` so the materialize → update transition
  // doesn't split into two history entries mid-typing.
  const editOpts = (slotIdx: number, role: 'system' | 'other'): ExamplesPatchOptions => ({
    history: {
      label: 'Edit message',
      coalesceKey: `${index}:${role === 'system' ? 'system' : `slot${slotIdx}`}`,
    },
  });

  const updateMessage = (
    msgIdx: number,
    patch: Partial<ConversationMessage>,
    opts?: ExamplesPatchOptions,
  ) => {
    const next = messages.map((m, i) => (i === msgIdx ? { ...m, ...patch } : m));
    onChange({ messages: next }, opts);
  };

  const removeMessage = (msgIdx: number) => {
    const next = messages.filter((_, i) => i !== msgIdx);
    onChange({ messages: next }, { history: { label: 'Remove turn' } });
  };

  const materializeSystem = (content: string) => {
    if (content === '') return;
    onChange(
      { messages: [{ role: 'system', content }, ...messages] },
      editOpts(0, 'system'),
    );
  };

  const realMessages = hasSystem ? messages.slice(1) : messages;

  return (
    <li
      ref={rowRef}
      className={`node-convo-row${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="node-convo-summary"
        aria-expanded={open}
        aria-controls={`node-convo-thread-${index}`}
        onClick={onToggleOpen}
      >
        <span className="node-convo-summary-index" aria-hidden>
          #{index + 1}
        </span>
        <span className="node-convo-summary-pill" title={`${turnCount} turn${turnCount === 1 ? '' : 's'}`}>
          <i className="ri-chat-3-line" aria-hidden />
          {turnCount}
        </span>
        {hasSystem && (
          <span
            className="node-convo-summary-system"
            title="Has system prompt"
            aria-label="Has system prompt"
          >
            <i className="ri-settings-3-line" aria-hidden />
          </span>
        )}
        <span className="node-convo-summary-preview">
          {previewText ? (
            previewText
          ) : (
            <em className="node-convo-summary-empty">Empty conversation</em>
          )}
        </span>
        {canRemove && (
          <span
            role="button"
            tabIndex={0}
            className="node-convo-summary-remove"
            aria-label={`Remove conversation ${index + 1}`}
            title="Remove conversation"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
          >
            <i className="ri-delete-bin-line" aria-hidden />
          </span>
        )}
        <span className="node-convo-summary-chevron" aria-hidden>
          <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
        </span>
      </button>
      {open && (
        <div
          id={`node-convo-thread-${index}`}
          className="node-convo-thread"
          role="group"
          aria-label={`Conversation ${index + 1} thread`}
        >
          <MessageBubble
            key="system"
            message={hasSystem ? messages[0]! : { role: 'system', content: '' }}
            inputRef={(el) => registerInput(0, el)}
            onAddTurn={() => onAddTurnAfter(0)}
            onChange={
              hasSystem
                ? (patch) => updateMessage(0, patch, editOpts(0, 'system'))
                : (patch) => materializeSystem(patch.content ?? '')
            }
            onRemove={hasSystem ? () => removeMessage(0) : undefined}
            onBackspaceEmpty={hasSystem ? () => onBackspaceEmpty(0) : undefined}
            onNavigatePrev={() => onNavigatePrev(0)}
            onNavigateNext={() => onNavigateNext(0)}
          />
          {realMessages.map((msg, i) => {
            const slotIdx = i + 1;
            const msgIdx = hasSystem ? slotIdx : i;
            return (
              <MessageBubble
                key={msgIdx}
                message={msg}
                inputRef={(el) => registerInput(slotIdx, el)}
                onAddTurn={() => onAddTurnAfter(slotIdx)}
                onChange={(patch) =>
                  updateMessage(msgIdx, patch, editOpts(slotIdx, 'other'))
                }
                onRemove={() => removeMessage(msgIdx)}
                onBackspaceEmpty={() => onBackspaceEmpty(slotIdx)}
                onNavigatePrev={() => onNavigatePrev(slotIdx)}
                onNavigateNext={() => onNavigateNext(slotIdx)}
              />
            );
          })}
          <div className="node-convo-thread-actions">
            <button
              type="button"
              className="node-convo-add-turn"
              onClick={() => onAddTurnAfter(slotCount(example) - 1)}
            >
              <i className="ri-add-line" aria-hidden />
              <span>Add turn</span>
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

type BubbleProps = {
  message: ConversationMessage;
  onChange: (patch: Partial<ConversationMessage>) => void;
  onRemove?: () => void;
  onAddTurn?: () => void;
  onBackspaceEmpty?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  inputRef?: (el: HTMLTextAreaElement | null) => void;
};

const ROLE_LABEL: Record<ConversationMessage['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
};

const ROLE_ICON: Record<ConversationMessage['role'], string> = {
  system: 'ri-settings-3-line',
  user: 'ri-user-3-line',
  assistant: 'ri-robot-2-line',
};

const ROLE_PLACEHOLDER: Record<ConversationMessage['role'], string> = {
  system: 'System instructions for this example…',
  user: 'What the user says…',
  assistant: 'How the assistant responds…',
};

function MessageBubble({
  message,
  onChange,
  onRemove,
  onAddTurn,
  onBackspaceEmpty,
  onNavigatePrev,
  onNavigateNext,
  inputRef,
}: BubbleProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    inputRef?.(el);
  };

  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    // Skip the height='auto' reset when we only need to grow — the brief
    // collapse it causes can confuse the parent scroll container's anchor
    // and pop scrollTop back to 0. Only collapse when shrinking.
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = `${el.scrollHeight}px`;
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [message.content]);

  return (
    <div className="node-convo-bubble" data-role={message.role}>
      <div className="node-convo-bubble-head">
        <span className="node-convo-bubble-role">
          <i className={ROLE_ICON[message.role]} aria-hidden />
          {ROLE_LABEL[message.role]}
        </span>
        {onRemove && (
          <button
            type="button"
            className="node-convo-bubble-remove"
            onClick={onRemove}
            aria-label={`Remove ${ROLE_LABEL[message.role]} message`}
            title="Remove turn"
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        )}
      </div>
      <textarea
        ref={setRef}
        className="node-convo-bubble-field"
        rows={1}
        placeholder={ROLE_PLACEHOLDER[message.role]}
        spellCheck={false}
        value={message.content}
        onChange={(e) => onChange({ content: e.target.value })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          const ta = e.currentTarget;
          const { selectionStart, selectionEnd, value } = ta;
          const collapsed = selectionStart === selectionEnd;

          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            onAddTurn
          ) {
            e.preventDefault();
            onAddTurn();
            return;
          }

          if (
            e.key === 'Backspace' &&
            value === '' &&
            collapsed &&
            onBackspaceEmpty
          ) {
            e.preventDefault();
            onBackspaceEmpty();
            return;
          }

          if (e.key === 'ArrowUp' && collapsed && onNavigatePrev) {
            const onFirstLine = !value.slice(0, selectionStart).includes('\n');
            if (onFirstLine) {
              e.preventDefault();
              onNavigatePrev();
            }
            return;
          }

          if (e.key === 'ArrowDown' && collapsed && onNavigateNext) {
            const onLastLine = !value.slice(selectionEnd).includes('\n');
            if (onLastLine) {
              e.preventDefault();
              onNavigateNext();
            }
            return;
          }
        }}
      />
    </div>
  );
}
