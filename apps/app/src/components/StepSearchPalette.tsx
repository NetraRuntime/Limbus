import { useCallback } from 'react';
import { SearchPalette } from './SearchPalette';
import type { NodeRecord } from '../features/llm-canvas';

type Props = {
  open: boolean;
  steps: NodeRecord[];
  onSelect: (step: NodeRecord) => void;
  onClose: () => void;
};

// LLM-canvas wrapper around the generic SearchPalette. Same role as
// MediaSearchPalette on the vision canvas — keeps each project type's
// "search" call site small and readable.
export function StepSearchPalette({ open, steps, onSelect, onClose }: Props) {
  const match = useCallback(
    (s: NodeRecord, q: string) => s.name.toLowerCase().includes(q),
    [],
  );
  return (
    <SearchPalette
      open={open}
      items={steps}
      onSelect={onSelect}
      onClose={onClose}
      match={match}
      placeholder="Search step…"
      ariaLabel="Search steps"
      emptyText="No matches"
      emptyWhenNoItemsText="No steps yet"
      renderItem={(s) => (
        <>
          <i className="ri-list-check-2 search-result-icon" aria-hidden />
          <span className="search-result-name">{s.name}</span>
        </>
      )}
    />
  );
}
