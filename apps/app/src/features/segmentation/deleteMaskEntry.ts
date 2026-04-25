import type { HistoryEntry } from '../../lib/history/types';
import {
  deleteSegmentationByImageTag,
  upsertSegmentation,
  type SegMask,
} from '../../lib/pb';

/**
 * Minimal structural mirror of the 'ready' variant of Canvas.tsx's TagSegment.
 * Kept decoupled so this helper does not depend on Canvas-local types.
 */
export type ReadyMaskEntry = {
  tag: string;
  status: 'ready';
  response: {
    masks: SegMask[];
    source_width: number;
    source_height: number;
  };
};

export type DeleteMaskMeta = {
  kind: 'delete-mask';
  imageId: string;
  tag: string;
};

export type DeleteMaskEntryArgs = {
  projectId: string;
  imageId: string;
  tag: string;
  /** Full snapshot of the ready entry for `tag` before deletion. */
  before: ReadyMaskEntry;
  /** Entry after deletion, or null if the tag has no masks left. */
  after: ReadyMaskEntry | null;
  /** Replace the ready entry for (imageId, tag), or remove it when entry is null. */
  replaceTag: (imageId: string, tag: string, entry: ReadyMaskEntry | null) => void;
  onConn: (state: 'ready' | 'offline') => void;
};

const persistTag = async (
  projectId: string,
  imageId: string,
  tag: string,
  target: ReadyMaskEntry | null,
  onConn: (state: 'ready' | 'offline') => void,
): Promise<void> => {
  try {
    if (target) {
      await upsertSegmentation(projectId, {
        image: imageId,
        tag: target.tag,
        masks: target.response.masks,
        source_width: target.response.source_width,
        source_height: target.response.source_height,
      });
    } else {
      await deleteSegmentationByImageTag(projectId, imageId, tag);
    }
    onConn('ready');
  } catch (err) {
    onConn('offline');
    console.warn('[sam3] delete-mask persist failed', err);
  }
};

export function deleteMaskEntry(
  args: DeleteMaskEntryArgs,
): HistoryEntry<DeleteMaskMeta> {
  const { projectId, imageId, tag, before, after, replaceTag, onConn } = args;
  return {
    label: `delete mask ${tag}`,
    meta: { kind: 'delete-mask', imageId, tag },
    do: () => {
      replaceTag(imageId, tag, after);
      void persistTag(projectId, imageId, tag, after, onConn);
    },
    undo: () => {
      replaceTag(imageId, tag, before);
      void persistTag(projectId, imageId, tag, before, onConn);
    },
  };
}
