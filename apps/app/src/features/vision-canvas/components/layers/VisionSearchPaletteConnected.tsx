import { useCallback, useMemo } from 'react';
import { useCanvasShell } from '../../../canvas-core';
import type { InfiniteCanvasHandle } from '../../../canvas-core';
import { MediaSearchPalette, type SearchItem } from '../MediaSearchPalette';
import { HIGHLIGHT_BOTTOM_INSET_PX } from '../../lib';
import { useVisionMedia } from '../../context/slices/useVisionMedia';

export function VisionSearchPaletteConnected() {
  const shell = useCanvasShell();
  const { searchOpen, setSearchOpen } = shell;
  const canvasRef = shell.canvasRef as React.RefObject<InfiniteCanvasHandle>;
  const { media } = useVisionMedia();

  const searchItems = useMemo<SearchItem[]>(
    () =>
      media
        .filter((m) => !m.pending)
        .map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          x: m.x,
          y: m.y,
          width: m.width,
          height: m.height,
        })),
    [media],
  );

  const handleSelect = useCallback(
    (item: SearchItem) => {
      setSearchOpen(false);
      canvasRef.current?.focusOn(
        { x: item.x, y: item.y, width: item.width, height: item.height },
        { animate: true, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
      );
    },
    [canvasRef, setSearchOpen],
  );

  return (
    <MediaSearchPalette
      open={searchOpen}
      items={searchItems}
      onSelect={handleSelect}
      onClose={() => setSearchOpen(false)}
    />
  );
}
