import { useWindowKeydown } from '../../canvas-core';

type Args = {
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useLlmCanvasKeyboardShortcuts({
  setSearchOpen,
  setSelectedId,
}: Args): void {
  useWindowKeydown(
    (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSelectedId(null);
      }
    },
    { capture: true },
  );
}
