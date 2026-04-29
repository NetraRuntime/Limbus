import type { ImageRecord, VideoRecord } from '../../../lib/pb';
import { upsertSegmentation } from '../../../lib/pb';
import {
  runAnnotationPlan,
  type AnnotationFormat,
  type AnnotationPlan,
  type SegGroup,
} from '../../../lib/annotations';
import {
  type MediaDescriptor,
} from '../../../lib/mediaIngest';
import { placeGrid } from '../../../lib/gridPlacement';
import type { WorldPoint } from '../../canvas-core';
import { loadImage, loadVideo } from './mediaRecord';
import { normalizeUploadSize } from './uploadSize';
import { uid } from './constants';
import type { CanvasMedia, SegmentState, TagSegment, UploadPlan } from './types';

type MediaDesc = MediaDescriptor & { kind: 'image' | 'video' };

export type PreparedImportPlan = {
  plan: UploadPlan[];
  descriptorByDraftId: Map<string, MediaDesc>;
  focusRect: { x: number; y: number; width: number; height: number };
};

/**
 * Loads each descriptor's File, measures dimensions, normalizes sizes
 * against existing media, and lays them out on a grid anchored at `point`.
 * Returns null when no files could be loaded.
 */
export async function prepareImportPlan(
  descriptors: MediaDescriptor[],
  point: WorldPoint,
  existingMedia: readonly CanvasMedia[],
): Promise<PreparedImportPlan | null> {
  const mediaDescriptors = descriptors.filter(
    (d): d is MediaDesc => d.kind === 'image' || d.kind === 'video',
  );

  const files: { file: File; kind: 'image' | 'video' }[] = [];
  const descriptorsForFiles: MediaDesc[] = [];
  for (const d of mediaDescriptors) {
    try {
      const f = await d.load();
      files.push({ file: f, kind: d.kind });
      descriptorsForFiles.push(d);
    } catch (err) {
      console.error('[ingest] load failed', d.relativePath, err);
    }
  }
  if (!files.length) return null;

  const rawLoaded = await Promise.all(
    files.map(async ({ file, kind }) => {
      const dims = await (kind === 'video' ? loadVideo(file) : loadImage(file));
      return { file, kind, ...dims };
    }),
  );

  // Normalize new items' longest side to the existing canvas median (or a
  // default when empty) so tiny icons and 4k photos don't land at wildly
  // different scales. Aspect ratio preserved; the original file uploads
  // unchanged — only the placed world dims are scaled.
  const reference = existingMedia.filter((m) => !m.pending);
  const loaded = rawLoaded.map((l) => ({
    ...l,
    ...normalizeUploadSize({ width: l.width, height: l.height }, reference),
  }));

  const gap = 32;
  const placements = placeGrid(
    loaded.map((l) => ({ width: l.width, height: l.height })),
    point,
    gap,
  );

  const plan: UploadPlan[] = loaded.map((l, i) => {
    const r = placements[i]!;
    const meta = {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      name: l.file.name,
    };
    return {
      draft: { id: uid(), kind: l.kind, src: l.src, pending: true, ...meta },
      file: l.file,
      meta,
    };
  });

  const descriptorByDraftId = new Map<string, MediaDesc>();
  for (let i = 0; i < plan.length; i++) {
    descriptorByDraftId.set(plan[i]!.draft.id, descriptorsForFiles[i]!);
  }

  const minX = Math.min(...plan.map((p) => p.draft.x));
  const minY = Math.min(...plan.map((p) => p.draft.y));
  const maxX = Math.max(...plan.map((p) => p.draft.x + p.draft.width));
  const maxY = Math.max(...plan.map((p) => p.draft.y + p.draft.height));
  const focusRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  return { plan, descriptorByDraftId, focusRect };
}

/**
 * Maps a draft id → uploaded image id by listening on the upload pipeline's
 * onUploaded callback. Wire as: `runUploadPlan(plan, makeImageIdCollector(...))`.
 */
export function makeImageIdCollector(
  descriptorByDraftId: Map<string, MediaDesc>,
  imageIdByDescriptorPath: Map<string, string>,
) {
  return (draftId: string, record: ImageRecord | VideoRecord) => {
    const desc = descriptorByDraftId.get(draftId);
    if (desc && desc.kind === 'image') {
      imageIdByDescriptorPath.set(desc.relativePath, record.id);
    }
  };
}

type ApplyAnnotationArgs = {
  projectId: string;
  plan: AnnotationPlan;
  chosenFormat: AnnotationFormat | 'none';
  descriptors: MediaDescriptor[];
  imageIdByDescriptorPath: Map<string, string>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
};

/**
 * Runs an annotation plan after uploads complete: upserts each segment
 * group to PocketBase and merges them into local canvas state so masks
 * light up immediately (without forcing a project reload).
 */
export async function applyAnnotationPlanToCanvas({
  projectId,
  plan,
  chosenFormat,
  descriptors,
  imageIdByDescriptorPath,
  setSegments,
}: ApplyAnnotationArgs): Promise<void> {
  if (chosenFormat === 'none' || imageIdByDescriptorPath.size === 0) return;

  const importedGroups: SegGroup[] = [];
  try {
    const { errors } = await runAnnotationPlan({
      plan,
      chosenFormat,
      descriptors,
      imageIdByDescriptorPath,
      upsert: async (group) => {
        await upsertSegmentation(projectId, {
          image: group.imageId,
          tag: group.tag,
          masks: group.masks,
          source_width: group.sourceWidth,
          source_height: group.sourceHeight,
        });
        importedGroups.push(group);
      },
    });
    if (errors.length > 0) console.warn('[annotations] errors:', errors);
  } catch (err) {
    console.error('[annotations] plan failed', err);
    return;
  }

  if (importedGroups.length === 0) return;
  setSegments((prev) => {
    const next = { ...prev };
    for (const group of importedGroups) {
      const existing = next[group.imageId]?.entries ?? [];
      const byTag = new Map<string, TagSegment>();
      for (const entry of existing) byTag.set(entry.tag.toLowerCase(), entry);
      byTag.set(group.tag.toLowerCase(), {
        tag: group.tag,
        status: 'ready',
        response: {
          masks: group.masks,
          source_width: group.sourceWidth,
          source_height: group.sourceHeight,
        },
      });
      next[group.imageId] = { entries: Array.from(byTag.values()) };
    }
    return next;
  });
}
