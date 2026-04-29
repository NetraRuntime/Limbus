import { useCallback } from 'react';
import { SearchPalette } from '../../../components/SearchPalette';
import type { ConversationMessage, NodeRecord } from '../types/canvas';

type Props = {
  open: boolean;
  steps: NodeRecord[];
  onSelect: (step: NodeRecord, exampleIdx?: number) => void;
  onClose: () => void;
};

const SNIPPET_PAD = 24;
const SNIPPET_MAX = 120;

type ContentHit = {
  exampleIdx: number;
  role: ConversationMessage['role'];
  snippet: string;
  hitStart: number;
  hitEnd: number;
};

const ROLE_LABEL: Record<ConversationMessage['role'], string> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
};

const findContentHit = (step: NodeRecord, q: string): ContentHit | null => {
  for (let i = 0; i < step.examples.length; i += 1) {
    const ex = step.examples[i]!;
    for (const msg of ex.messages) {
      const idx = msg.content.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      const start = Math.max(0, idx - SNIPPET_PAD);
      const end = Math.min(msg.content.length, idx + q.length + SNIPPET_PAD);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < msg.content.length ? '…' : '';
      const sliced = msg.content.slice(start, end);
      const snippet = (prefix + sliced + suffix).slice(0, SNIPPET_MAX);
      return {
        exampleIdx: i,
        role: msg.role,
        snippet,
        hitStart: idx - start + prefix.length,
        hitEnd: idx - start + prefix.length + q.length,
      };
    }
  }
  return null;
};

const matchesQuery = (step: NodeRecord, q: string): boolean => {
  if (step.name.toLowerCase().includes(q)) return true;
  return findContentHit(step, q) !== null;
};

// LLM-canvas wrapper around the generic SearchPalette. Same role as
// MediaSearchPalette on the vision canvas — keeps each project type's
// "search" call site small and readable.
export function StepSearchPalette({ open, steps, onSelect, onClose }: Props) {
  const match = useCallback(matchesQuery, []);
  return (
    <SearchPalette
      open={open}
      items={steps}
      onSelect={(step, { query }) => {
        const q = query.trim().toLowerCase();
        if (!q || step.name.toLowerCase().includes(q)) {
          onSelect(step);
          return;
        }
        const hit = findContentHit(step, q);
        onSelect(step, hit?.exampleIdx);
      }}
      onClose={onClose}
      match={match}
      placeholder="Search step or message…"
      ariaLabel="Search steps"
      emptyText="No matches"
      emptyWhenNoItemsText="No steps yet"
      renderItem={(s, { query }) => {
        const q = query.trim().toLowerCase();
        const nameHit = q && s.name.toLowerCase().includes(q);
        const contentHit = q && !nameHit ? findContentHit(s, q) : null;
        return (
          <>
            <i className="ri-list-check-2 search-result-icon" aria-hidden />
            <span className="search-result-body">
              <span className="search-result-name">{s.name}</span>
              {contentHit && (
                <span className="search-result-snippet">
                  <span className="search-result-snippet-role">
                    {ROLE_LABEL[contentHit.role]} · #{contentHit.exampleIdx + 1}
                  </span>
                  <SnippetText
                    snippet={contentHit.snippet}
                    hitStart={contentHit.hitStart}
                    hitEnd={contentHit.hitEnd}
                  />
                </span>
              )}
            </span>
          </>
        );
      }}
    />
  );
}

type SnippetTextProps = {
  snippet: string;
  hitStart: number;
  hitEnd: number;
};

function SnippetText({ snippet, hitStart, hitEnd }: SnippetTextProps) {
  return (
    <span className="search-result-snippet-text">
      {snippet.slice(0, hitStart)}
      <mark>{snippet.slice(hitStart, hitEnd)}</mark>
      {snippet.slice(hitEnd)}
    </span>
  );
}
