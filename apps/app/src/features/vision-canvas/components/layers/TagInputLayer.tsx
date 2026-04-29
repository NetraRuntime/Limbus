import { HighlightInput } from '../HighlightInput';
import type { View } from '../../../canvas-core';
import { EMPTY_TAGS, type CanvasMedia } from '../../lib';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ActiveRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  projectId: string;
  activeMedia: CanvasMedia | null;
  activeRect: ActiveRect | null;
  highlightInputs: Record<string, string[]>;
  setHighlightInputs: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
  selectionBBox: Bounds | null;
  marqueeRect: unknown | null;
  view: View;
  multiSelectKey: string;
  multiHighlightInput: string[];
  setMultiHighlightInput: React.Dispatch<React.SetStateAction<string[]>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  clearSelection: () => void;
  clearHideTimer: () => void;
  scheduleHide: () => void;
  deleteSelection: () => void;
  onSubmitSegment: (m: CanvasMedia, next: string[]) => void;
};

export function TagInputLayer({
  projectId,
  activeMedia,
  activeRect,
  highlightInputs,
  setHighlightInputs,
  selectionBBox,
  marqueeRect,
  view,
  multiSelectKey,
  multiHighlightInput,
  setMultiHighlightInput,
  selectedIds,
  setSelectedIds,
  setLastSelectedId,
  clearSelection,
  clearHideTimer,
  scheduleHide,
  deleteSelection,
  onSubmitSegment,
}: Props) {
  return (
    <>
      {activeMedia && activeRect && (
        <HighlightInput
          key={activeMedia.id}
          rect={activeRect}
          tags={highlightInputs[activeMedia.id] ?? (EMPTY_TAGS as string[])}
          onTagsChange={(next) =>
            setHighlightInputs((prev) => ({ ...prev, [activeMedia.id]: next }))
          }
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onFocus={() => {
            clearHideTimer();
            setSelectedIds(new Set([activeMedia.id]));
            setLastSelectedId(activeMedia.id);
          }}
          onBlur={() => {
            const current = highlightInputs[activeMedia.id] ?? [];
            if (current.length === 0) clearSelection();
            scheduleHide();
          }}
          onEscape={() => {
            clearSelection();
            scheduleHide();
          }}
          onSubmit={(next) => {
            onSubmitSegment(activeMedia, next);
            setHighlightInputs((prev) =>
              activeMedia.id in prev
                ? { ...prev, [activeMedia.id]: EMPTY_TAGS as string[] }
                : prev,
            );
          }}
          onDeleteWhenEmpty={deleteSelection}
          autoFocus={selectedIds.has(activeMedia.id)}
          projectId={projectId}
        />
      )}

      {selectionBBox && !marqueeRect && (
        <HighlightInput
          key={multiSelectKey}
          rect={{
            x: selectionBBox.minX * view.scale + view.x,
            y: selectionBBox.minY * view.scale + view.y,
            width: Math.max(
              0,
              (selectionBBox.maxX - selectionBBox.minX) * view.scale,
            ),
            height: Math.max(
              0,
              (selectionBBox.maxY - selectionBBox.minY) * view.scale,
            ),
          }}
          tags={multiHighlightInput}
          onTagsChange={setMultiHighlightInput}
          onEscape={clearSelection}
          onDeleteWhenEmpty={deleteSelection}
          projectId={projectId}
        />
      )}
    </>
  );
}
