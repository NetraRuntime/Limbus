import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  ConversationMessage,
  NodeExample,
  NodeRecord,
} from '../types/canvas';

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
        {children ?? <NodeConversationList node={node} onPatch={onPatch} />}
      </div>
    </aside>
  );
}

type ListProps = {
  node: NodeRecord;
  onPatch?: (id: string, patch: { examples?: NodeExample[] }) => void;
};

const emptyExample = (): NodeExample => ({ messages: [] });

function NodeConversationList({ node, onPatch }: ListProps) {
  const examples: NodeExample[] =
    node.examples.length > 0 ? node.examples : [emptyExample()];

  const commit = (next: NodeExample[]) => onPatch?.(node.id, { examples: next });

  const updateExample = (idx: number, patch: NodeExample) => {
    const base = node.examples.length > 0 ? node.examples.slice() : [emptyExample()];
    while (base.length <= idx) base.push(emptyExample());
    base[idx] = patch;
    commit(base);
  };

  const addExample = () => {
    const base = node.examples.length > 0 ? node.examples.slice() : [emptyExample()];
    base.push(emptyExample());
    commit(base);
  };

  const removeExample = (idx: number) => {
    const base = node.examples.length > 0 ? node.examples : [emptyExample()];
    const next = base.filter((_, i) => i !== idx);
    commit(next);
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
            onChange={(next) => updateExample(idx, next)}
            onRemove={() => removeExample(idx)}
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
    </div>
  );
}

type RowProps = {
  index: number;
  example: NodeExample;
  canRemove: boolean;
  onChange: (next: NodeExample) => void;
  onRemove: () => void;
};

function ConversationRow({ index, example, canRemove, onChange, onRemove }: RowProps) {
  const [open, setOpen] = useState(index === 0);
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

  const updateMessage = (msgIdx: number, patch: Partial<ConversationMessage>) => {
    const next = messages.map((m, i) => (i === msgIdx ? { ...m, ...patch } : m));
    onChange({ messages: next });
  };

  const removeMessage = (msgIdx: number) => {
    const next = messages.filter((_, i) => i !== msgIdx);
    onChange({ messages: next });
  };

  const materializeSystem = (content: string) => {
    if (content === '') return;
    onChange({ messages: [{ role: 'system', content }, ...messages] });
  };

  const addTurn = () => {
    const lastNonSystem = [...messages].reverse().find((m) => m.role !== 'system');
    const nextRole: ConversationMessage['role'] =
      lastNonSystem?.role === 'user' ? 'assistant' : 'user';
    onChange({ messages: [...messages, { role: nextRole, content: '' }] });
  };

  const realMessages = hasSystem ? messages.slice(1) : messages;

  return (
    <li className={`node-convo-row${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="node-convo-summary"
        aria-expanded={open}
        aria-controls={`node-convo-thread-${index}`}
        onClick={() => setOpen((v) => !v)}
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
          {hasSystem ? (
            <MessageBubble
              key="system"
              message={messages[0]!}
              onChange={(patch) => updateMessage(0, patch)}
              onRemove={() => removeMessage(0)}
            />
          ) : (
            <MessageBubble
              key="system-virtual"
              message={{ role: 'system', content: '' }}
              onChange={(patch) => materializeSystem(patch.content ?? '')}
            />
          )}
          {realMessages.map((msg, i) => {
            const msgIdx = hasSystem ? i + 1 : i;
            return (
              <MessageBubble
                key={msgIdx}
                message={msg}
                onChange={(patch) => updateMessage(msgIdx, patch)}
                onRemove={() => removeMessage(msgIdx)}
              />
            );
          })}
          <div className="node-convo-thread-actions">
            <button
              type="button"
              className="node-convo-add-turn"
              onClick={addTurn}
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

function MessageBubble({ message, onChange, onRemove }: BubbleProps) {
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
        className="node-convo-bubble-field"
        rows={message.role === 'system' ? 2 : 3}
        placeholder={ROLE_PLACEHOLDER[message.role]}
        spellCheck={false}
        value={message.content}
        onChange={(e) => onChange({ content: e.target.value })}
      />
    </div>
  );
}
