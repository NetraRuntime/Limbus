import type { ConversationMessage, MessageRole, NodeExample } from '../types/canvas';

export type ImportFormat = 'sharegpt' | 'chatml' | 'csv' | 'txt';

export type ImportResult = {
  format: ImportFormat;
  examples: NodeExample[];
};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const ROLE_ALIASES: Record<string, MessageRole> = {
  system: 'system',
  developer: 'system',
  instruction: 'system',
  user: 'user',
  human: 'user',
  customer: 'user',
  assistant: 'assistant',
  gpt: 'assistant',
  bot: 'assistant',
  ai: 'assistant',
  model: 'assistant',
  chatbot: 'assistant',
};

const normaliseRole = (raw: unknown): MessageRole | null => {
  if (typeof raw !== 'string') return null;
  return ROLE_ALIASES[raw.trim().toLowerCase()] ?? null;
};

const normaliseContent = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  if (Array.isArray(raw)) {
    // OpenAI multi-part content: [{type:'text', text:'...'}, ...]
    return raw
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof raw === 'object') {
    const text = (raw as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    return '';
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Convert one ShareGPT-style turn `{from, value}` into a ConversationMessage. */
const shareGptTurn = (raw: unknown): ConversationMessage | null => {
  if (!isPlainObject(raw)) return null;
  const role = normaliseRole(raw.from ?? raw.role);
  if (!role) return null;
  return { role, content: normaliseContent(raw.value ?? raw.content) };
};

/** Convert one ChatML-style turn `{role, content}` into a ConversationMessage. */
const chatMlTurn = (raw: unknown): ConversationMessage | null => {
  if (!isPlainObject(raw)) return null;
  const role = normaliseRole(raw.role ?? raw.from);
  if (!role) return null;
  return { role, content: normaliseContent(raw.content ?? raw.value) };
};

const turnsToExample = (turns: (ConversationMessage | null)[]): NodeExample | null => {
  const messages = turns.filter((t): t is ConversationMessage => t !== null);
  if (messages.length === 0) return null;
  return { messages };
};

/** Try to interpret a single object as one conversation. Detects format. */
const objectToExample = (
  obj: Record<string, unknown>,
): { example: NodeExample; format: 'sharegpt' | 'chatml' } | null => {
  if (Array.isArray(obj.conversations)) {
    const ex = turnsToExample(obj.conversations.map(shareGptTurn));
    return ex ? { example: ex, format: 'sharegpt' } : null;
  }
  if (Array.isArray(obj.messages)) {
    const ex = turnsToExample(obj.messages.map(chatMlTurn));
    return ex ? { example: ex, format: 'chatml' } : null;
  }
  return null;
};

/** Try to interpret an array as a list of turns (single conversation) or a
 *  list of conversation objects (multiple conversations). */
const arrayToExamples = (
  arr: unknown[],
): { examples: NodeExample[]; format: 'sharegpt' | 'chatml' } | null => {
  if (arr.length === 0) return { examples: [], format: 'chatml' };

  const first = arr[0];
  if (isPlainObject(first) && (Array.isArray(first.conversations) || Array.isArray(first.messages))) {
    const examples: NodeExample[] = [];
    let format: 'sharegpt' | 'chatml' = 'chatml';
    for (const item of arr) {
      if (!isPlainObject(item)) continue;
      const result = objectToExample(item);
      if (result) {
        examples.push(result.example);
        format = result.format;
      }
    }
    return { examples, format };
  }

  if (isPlainObject(first) && ('from' in first || 'value' in first)) {
    const ex = turnsToExample(arr.map(shareGptTurn));
    return ex ? { examples: [ex], format: 'sharegpt' } : { examples: [], format: 'sharegpt' };
  }

  if (isPlainObject(first) && ('role' in first || 'content' in first)) {
    const ex = turnsToExample(arr.map(chatMlTurn));
    return ex ? { examples: [ex], format: 'chatml' } : { examples: [], format: 'chatml' };
  }

  return null;
};

const parseJson = (text: string): ImportResult => {
  const trimmed = text.trim();
  if (trimmed === '') throw new ImportError('File is empty.');

  // JSONL: every non-empty line parses as JSON. Treat each line as a record.
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '');
  const looksJsonl =
    lines.length > 1 && lines.every((l) => /^[[{]/.test(l.trim()));

  if (looksJsonl) {
    const examples: NodeExample[] = [];
    let format: 'sharegpt' | 'chatml' = 'chatml';
    for (const [i, line] of lines.entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new ImportError(
          `Invalid JSON on line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (isPlainObject(parsed)) {
        const result = objectToExample(parsed);
        if (result) {
          examples.push(result.example);
          format = result.format;
        }
      } else if (Array.isArray(parsed)) {
        const result = arrayToExamples(parsed);
        if (result) {
          examples.push(...result.examples);
          format = result.format;
        }
      }
    }
    if (examples.length === 0) {
      throw new ImportError('No conversations found in JSONL file.');
    }
    return { format, examples };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new ImportError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (Array.isArray(parsed)) {
    const result = arrayToExamples(parsed);
    if (!result) {
      throw new ImportError(
        'JSON array elements must be ShareGPT or ChatML conversations.',
      );
    }
    if (result.examples.length === 0) {
      throw new ImportError('No conversations found in JSON.');
    }
    return { format: result.format, examples: result.examples };
  }

  if (isPlainObject(parsed)) {
    const single = objectToExample(parsed);
    if (single) return { format: single.format, examples: [single.example] };

    // Some datasets wrap a list under `data` / `conversations` / `examples`.
    for (const key of ['data', 'examples', 'rows', 'samples']) {
      const inner = parsed[key];
      if (Array.isArray(inner)) {
        const result = arrayToExamples(inner);
        if (result && result.examples.length > 0) {
          return { format: result.format, examples: result.examples };
        }
      }
    }
  }

  throw new ImportError(
    'Unrecognised JSON shape. Expected ShareGPT { conversations: [...] } or ChatML { messages: [...] }.',
  );
};

/** Tokenise one CSV row, respecting RFC 4180 quoting. */
const parseCsvRow = (line: string): string[] => {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
};

/** Split CSV text into rows, honoring quoted newlines. */
const splitCsvRows = (text: string): string[] => {
  const rows: string[] = [];
  let row = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      row += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.push(row);
      row = '';
    } else {
      row += ch;
    }
  }
  if (row !== '') rows.push(row);
  return rows;
};

const findColumn = (headers: string[], names: string[]): number => {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
};

const parseCsv = (text: string): ImportResult => {
  const rows = splitCsvRows(text).filter((r) => r.trim() !== '');
  if (rows.length < 2) {
    throw new ImportError('CSV must have a header row and at least one data row.');
  }

  const headers = parseCsvRow(rows[0]!).map((h) => h.trim().toLowerCase());
  const roleIdx = findColumn(headers, ['role', 'from', 'speaker', 'sender']);
  const contentIdx = findColumn(headers, ['content', 'value', 'message', 'text']);
  const convIdx = findColumn(headers, [
    'conversation',
    'conversation_id',
    'conversationid',
    'dialog',
    'dialog_id',
    'dialogue_id',
    'session',
    'session_id',
    'thread',
    'thread_id',
  ]);

  if (roleIdx === -1 || contentIdx === -1) {
    throw new ImportError(
      'CSV must include a role column (role/from/speaker) and a content column (content/value/message/text).',
    );
  }

  const groups = new Map<string, ConversationMessage[]>();
  const order: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = parseCsvRow(rows[i]!);
    const role = normaliseRole(cells[roleIdx]);
    if (!role) continue;
    const content = normaliseContent(cells[contentIdx]);
    const rawConv = convIdx !== -1 ? cells[convIdx]?.trim() ?? '' : '';
    const convKey = rawConv !== '' ? rawConv : '__default__';
    if (!groups.has(convKey)) {
      groups.set(convKey, []);
      order.push(convKey);
    }
    groups.get(convKey)!.push({ role, content });
  }

  const examples: NodeExample[] = [];
  for (const key of order) {
    const messages = groups.get(key)!;
    if (messages.length > 0) examples.push({ messages });
  }

  if (examples.length === 0) {
    throw new ImportError('No valid conversation rows found in CSV.');
  }

  return { format: 'csv', examples };
};

/** TXT format: lines prefixed with `Role:` (system/user/assistant or aliases).
 *  Blank lines or `---` separators split conversations. Continuation lines
 *  (without a recognised prefix) are appended to the previous turn. */
const parseTxt = (text: string): ImportResult => {
  const lines = text.split(/\r?\n/);
  const prefixRe = /^\s*([A-Za-z][A-Za-z0-9 _-]{0,30}?)\s*[:>-]\s?(.*)$/;

  let current: ConversationMessage[] = [];
  const examples: NodeExample[] = [];

  const flush = () => {
    if (current.length > 0) examples.push({ messages: current });
    current = [];
  };

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();

    if (trimmed === '' || /^-{3,}$|^={3,}$|^#{3,}$/.test(trimmed)) {
      flush();
      continue;
    }

    const match = prefixRe.exec(line);
    const role = match ? normaliseRole(match[1]) : null;

    if (role) {
      current.push({ role, content: match![2] ?? '' });
      continue;
    }

    if (current.length === 0) {
      // No leading role prefix: treat the whole leading run as a single user
      // turn. Common when users paste raw text they want as a `user` message.
      current.push({ role: 'user', content: line });
      continue;
    }

    const last = current[current.length - 1]!;
    last.content = last.content === '' ? line : `${last.content}\n${line}`;
  }
  flush();

  for (const ex of examples) {
    for (const m of ex.messages) m.content = m.content.replace(/\s+$/g, '');
  }

  if (examples.length === 0) {
    throw new ImportError('No conversation content found in text file.');
  }

  return { format: 'txt', examples };
};

const detectFormat = (filename: string): 'json' | 'csv' | 'txt' => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    return 'json';
  }
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  return 'txt';
};

export function parseConversationsFile(
  filename: string,
  text: string,
): ImportResult {
  switch (detectFormat(filename)) {
    case 'json':
      return parseJson(text);
    case 'csv':
      return parseCsv(text);
    case 'txt':
    default:
      return parseTxt(text);
  }
}
