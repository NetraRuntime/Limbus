import { useWindowKeydown } from '../../canvas-core';

type Args = {
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useLlmCanvasKeyboardShortcuts({ setSelectedId }: Args): void {
  useWindowKeydown(
    (e) => {
      if (e.key === 'Escape') {
        setSelectedId(null);
      }
    },
    { capture: true },
  );
}
