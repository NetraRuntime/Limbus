import type { HistoryEntry } from '../../lib/history/types';
import { upsertSegmentation } from '../../lib/pb';
import type { ReadyMaskEntry } from './deleteMaskEntry';

export type ResizeBboxMeta = {
  kind: 'resize-bbox';
  imageId: string;
  tag: string;
  maskIndex: number;
};

export type ResizeBboxEntryArgs = {
  imageId: string;
  tag: string;
  maskIndex: number;
  /** Full snapshot of the ready entry for `tag` before the resize. */
  before: ReadyMaskEntry;
  /** Full snapshot of the ready entry for `tag` after the resize. */
  after: ReadyMaskEntry;
  /** Replace the ready entry for (imageId, tag). */
  replaceTag: (imageId: string, tag: string, entry: ReadyMaskEntry | null) => void;
  onConn: (state: 'ready' | 'offline') => void;
};

const persistTag = async (
  imageId: string,
  target: ReadyMaskEntry,
  onConn: (state: 'ready' | 'offline') => void,
): Promise<void> => {
  try {
    await upsertSegmentation({
      image: imageId,
      tag: target.tag,
      masks: target.response.masks,
      source_width: target.response.source_width,
      source_height: target.response.source_height,
    });
    onConn('ready');
  } catch (err) {
    onConn('offline');
    console.warn('[sam3] resize-bbox persist failed', err);
  }
};

export function resizeBboxEntry(
  args: ResizeBboxEntryArgs,
): HistoryEntry<ResizeBboxMeta> {
  const { imageId, tag, maskIndex, before, after, replaceTag, onConn } = args;
  return {
    label: `resize bbox ${tag}`,
    meta: { kind: 'resize-bbox', imageId, tag, maskIndex },
    do: () => {
      replaceTag(imageId, tag, after);
      void persistTag(imageId, after, onConn);
    },
    undo: () => {
      replaceTag(imageId, tag, before);
      void persistTag(imageId, before, onConn);
    },
  };
}
