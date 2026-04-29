import { useEffect, useState, type KeyboardEvent } from 'react';

type Args = {
  suggestionsCount: number;
  canConfirm: boolean;
  onCommit: (idx: number | null) => void;
  onCancel: () => void;
};

type Result = {
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  resetActive: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export function useBoxLabelKeyboard({
  suggestionsCount,
  canConfirm,
  onCommit,
  onCancel,
}: Args): Result {
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (activeIdx >= suggestionsCount) setActiveIdx(-1);
  }, [suggestionsCount, activeIdx]);

  const resetActive = () => setActiveIdx(-1);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestionsCount > 0) {
      e.preventDefault();
      setActiveIdx((activeIdx + 1) % suggestionsCount);
      return;
    }
    if (e.key === 'ArrowUp' && suggestionsCount > 0) {
      e.preventDefault();
      setActiveIdx(activeIdx <= 0 ? suggestionsCount - 1 : activeIdx - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < suggestionsCount) {
        onCommit(activeIdx);
      } else if (canConfirm) {
        onCommit(null);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeIdx >= 0) {
        setActiveIdx(-1);
        return;
      }
      onCancel();
    }
  };

  return { activeIdx, setActiveIdx, resetActive, onKeyDown };
}
