import type { RefObject } from 'react';
import {
  useWindowKeydown,
  type InfiniteCanvasHandle,
} from '../../canvas-core';
import { isTypingContext } from '../../../lib/dom/isTypingContext';
import {
  nextSoloTag,
  type MaskIdentity,
} from '../../segmentation';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  type CanvasMedia,
  type SegmentState,
} from '../lib';

type Args = {
  canvasRef: RefObject<InfiniteCanvasHandle>;
  mediaRef: RefObject<CanvasMedia[]>;
  selectedIdsRef: RefObject<Set<string>>;
  lastSelectedIdRef: RefObject<string | null>;
  segmentsRef: RefObject<Record<string, SegmentState>>;
  activeMedia: CanvasMedia | null;
  selectedMask: MaskIdentity | null;
  soloTag: string | null;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
  setSoloTag: React.Dispatch<React.SetStateAction<string | null>>;
  setTool: (tool: 'drag' | 'box') => void;
  clearHideTimer: () => void;
  clearSelection: () => void;
  selectAll: () => void;
  duplicateSelection: () => Promise<void>;
  deleteSelection: () => void;
  deleteMask: (target: MaskIdentity) => void;
  deleteAllMasksForTag: (imageId: string, tag: string) => void;
};

const isInputTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
};

/**
 * Wires the seven canvas-wide keyboard shortcuts:
 * - Escape (clear selection), Tab (cycle media), Cmd-A (select all),
 *   Cmd-D (duplicate), Delete/Backspace (delete selection)
 * - V/B (tool switch — only when a media is active)
 * - Delete/Backspace (delete the selected mask)
 * - ArrowUp/Down (cycle solo tag)
 * - Delete/Backspace (delete all masks for solo tag)
 */
export function useCanvasKeyboardShortcuts({
  canvasRef,
  mediaRef,
  selectedIdsRef,
  lastSelectedIdRef,
  segmentsRef,
  activeMedia,
  selectedMask,
  soloTag,
  setSelectedIds,
  setLastSelectedId,
  setHoverId,
  setSoloTag,
  setTool,
  clearHideTimer,
  clearSelection,
  selectAll,
  duplicateSelection,
  deleteSelection,
  deleteMask,
  deleteAllMasksForTag,
}: Args): void {
  // Selection-level shortcuts (capture phase): Escape, Tab cycle,
  // Cmd-A select all, Cmd-D duplicate, Delete batch.
  useWindowKeydown(
    (e) => {
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // The HighlightInput autofocuses when a single item is selected, so
        // cycling lands us back in a typing context on every other press.
        // Treat it as a navigation companion — Tab there still cycles.
        const tgt = e.target instanceof Element ? e.target : null;
        const activeEl =
          document.activeElement instanceof Element
            ? document.activeElement
            : null;
        const inHighlightInput =
          tgt?.closest('.highlight-input') != null ||
          activeEl?.closest('.highlight-input') != null;
        if (!inHighlightInput && isTypingContext(e)) return;
        const list = (mediaRef.current ?? []).filter((m) => !m.pending);
        if (list.length === 0) return;
        e.preventDefault();
        const selIds = selectedIdsRef.current ?? new Set<string>();
        const lastId = lastSelectedIdRef.current ?? null;
        const anchorId =
          (lastId && selIds.has(lastId) ? lastId : null) ??
          (selIds.size > 0 ? (Array.from(selIds).pop() ?? null) : null);
        const currentIndex = anchorId
          ? list.findIndex((m) => m.id === anchorId)
          : -1;
        const dir = e.shiftKey ? -1 : 1;
        const nextIndex =
          currentIndex === -1
            ? dir === 1
              ? 0
              : list.length - 1
            : (currentIndex + dir + list.length) % list.length;
        const target = list[nextIndex];
        if (!target) return;
        clearHideTimer();
        setSelectedIds(new Set([target.id]));
        setLastSelectedId(target.id);
        setHoverId(target.id);
        canvasRef.current?.focusOn(
          {
            x: target.x,
            y: target.y,
            width: target.width,
            height: target.height,
          },
          { padding: 0.12, bottomInset: HIGHLIGHT_BOTTOM_INSET_PX },
        );
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'a'
      ) {
        if (isTypingContext(e)) return;
        e.preventDefault();
        selectAll();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'd'
      ) {
        e.preventDefault();
        if ((selectedIdsRef.current?.size ?? 0) === 0) return;
        void duplicateSelection();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTypingContext(e)) return;
      if ((selectedIdsRef.current?.size ?? 0) === 0) return;
      e.preventDefault();
      deleteSelection();
    },
    { capture: true },
  );

  // Tool shortcuts — only while the floating media toolbar is visible.
  useWindowKeydown(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'v') {
        e.preventDefault();
        setTool('drag');
      } else if (k === 'b') {
        e.preventDefault();
        setTool('box');
      }
    },
    { enabled: !!activeMedia },
  );

  // Delete the selected mask.
  useWindowKeydown((e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!selectedMask) return;
    if (isInputTarget(e.target)) return;
    e.preventDefault();
    deleteMask(selectedMask);
  });

  // Cycle solo tag with ArrowUp/Down.
  useWindowKeydown((e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (isTypingContext(e)) return;
    if (!activeMedia || activeMedia.kind !== 'image') return;
    if (!soloTag) return;
    const entries = segmentsRef.current?.[activeMedia.id]?.entries;
    if (!entries || entries.length === 0) return;
    const dir = e.key === 'ArrowDown' ? 'next' : 'prev';
    const next = nextSoloTag(
      soloTag,
      entries.map((en) => ({ tag: en.tag, status: en.status })),
      dir,
    );
    if (!next) return;
    e.preventDefault();
    setSoloTag(next);
  });

  // Delete all masks for the current solo tag.
  useWindowKeydown((e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingContext(e)) return;
    if (!activeMedia || activeMedia.kind !== 'image') return;
    if (!soloTag) return;
    // Defer to the mask-delete handler when a specific mask is selected —
    // that path deletes one mask, not the whole tag.
    if (selectedMask) return;
    // The pill's own button-level onKeyDown already handles Delete when a
    // pill is focused. Skip here to avoid double-firing (and pushing two
    // history entries) as the native event bubbles to window.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.media-tag-list')) return;
    e.preventDefault();
    deleteAllMasksForTag(activeMedia.id, soloTag);
  });
}
