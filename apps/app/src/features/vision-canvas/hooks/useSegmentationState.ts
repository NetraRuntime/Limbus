import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  deleteAllSegmentationsForImage,
  deleteSegmentationsForImage,
  upsertSegmentation,
} from '../../../lib/pb';
import {
  evictBake,
  deleteMaskEntry,
  type MaskIdentity,
  type ReadyMaskEntry,
} from '../../segmentation';
import type { UseHistoryReturn } from '../../../lib/history';
import type { CanvasActionMeta } from '../../../lib/canvasHistory';
import type {
  CanvasMedia,
  ConnState,
  PendingBoxLabel,
  SegmentResponse,
  SegmentState,
  TagSegment,
  UserBox,
} from '../lib';

type Args = {
  projectId: string;
  sam3Available: boolean;
  mediaRef: RefObject<CanvasMedia[]>;
  history: UseHistoryReturn<CanvasActionMeta>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  pendingBoxLabel: PendingBoxLabel | null;
  setPendingBoxLabel: React.Dispatch<React.SetStateAction<PendingBoxLabel | null>>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setUserBoxes: React.Dispatch<React.SetStateAction<Record<string, UserBox[]>>>;
  rememberSavedTag: (tag: string) => Promise<unknown>;
  /** Controlled segments state (lifted to the provider for hydration). */
  segments: Record<string, SegmentState>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
  /** Controlled selectedMask state (lifted to the page so the provider can clear it). */
  selectedMask: MaskIdentity | null;
  setSelectedMask: React.Dispatch<React.SetStateAction<MaskIdentity | null>>;
  /** Controlled soloTag state (lifted to the page so the provider can clear it). */
  soloTag: string | null;
  setSoloTag: React.Dispatch<React.SetStateAction<string | null>>;
};

export type SegmentationState = {
  segments: Record<string, SegmentState>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
  segmentsRef: RefObject<Record<string, SegmentState>>;
  selectedMask: MaskIdentity | null;
  setSelectedMask: React.Dispatch<React.SetStateAction<MaskIdentity | null>>;
  hoveredMask: MaskIdentity | null;
  soloTag: string | null;
  setSoloTag: React.Dispatch<React.SetStateAction<string | null>>;
  handleMaskSelect: (id: MaskIdentity) => void;
  handleMaskHover: (id: MaskIdentity | null) => void;
  clearSegment: (id: string) => void;
  replaceReadyTag: (
    imageId: string,
    tag: string,
    entry: ReadyMaskEntry | null,
  ) => void;
  deleteMask: (target: MaskIdentity) => void;
  deleteAllMasksForTag: (imageId: string, tag: string) => void;
  removeSegmentTag: (id: string, tag: string) => void;
  submitSegment: (m: CanvasMedia, tags: string[]) => void;
  confirmPendingBoxLabel: (rawLabel: string) => void;
  cancelPendingBoxLabel: () => void;
};

export function useSegmentationState({
  projectId,
  sam3Available,
  mediaRef,
  history,
  setConn,
  pendingBoxLabel,
  setPendingBoxLabel,
  selectedIds,
  setSelectedIds,
  setLastSelectedId,
  setUserBoxes,
  rememberSavedTag,
  segments,
  setSegments,
  selectedMask,
  setSelectedMask,
  soloTag,
  setSoloTag,
}: Args): SegmentationState {
  const [hoveredMask, setHoveredMask] = useState<MaskIdentity | null>(null);
  const segmentSeqRef = useRef<Record<string, number>>({});
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Selecting media unselects any individual mask — the two are mutually
  // exclusive selection modes.
  useEffect(() => {
    if (selectedIds.size > 0) setSelectedMask(null);
    // setSelectedMask identity is stable (lifted from useState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const handleMaskSelect = useCallback(
    (id: MaskIdentity) => {
      setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setLastSelectedId(null);
      setSelectedMask(id);
    },
    [setLastSelectedId, setSelectedIds, setSelectedMask],
  );

  const handleMaskHover = useCallback((id: MaskIdentity | null) => {
    setHoveredMask((prev) => {
      if (id === prev) return prev;
      if (
        id &&
        prev &&
        id.imageId === prev.imageId &&
        id.tag === prev.tag &&
        id.maskIndex === prev.maskIndex
      ) {
        return prev;
      }
      return id;
    });
  }, []);

  const clearSegment = useCallback(
    (id: string) => {
      // Bump the sequence so any in-flight invoke for this id is ignored when
      // it resolves.
      segmentSeqRef.current[id] = (segmentSeqRef.current[id] ?? 0) + 1;
      setSegments((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      deleteAllSegmentationsForImage(projectId, id).catch((e) =>
        console.warn('[sam3] clear-persist failed', id, e),
      );
      evictBake(id);
    },
    [projectId],
  );

  const replaceReadyTag = useCallback(
    (imageId: string, tag: string, entry: ReadyMaskEntry | null) => {
      const key = tag.toLowerCase();
      setSegments((prev) => {
        const cur = prev[imageId];
        if (!cur) {
          if (!entry) return prev;
          return { ...prev, [imageId]: { entries: [entry] } };
        }
        const next: TagSegment[] = [];
        let replaced = false;
        for (const e of cur.entries) {
          if (e.tag.toLowerCase() === key) {
            if (entry) {
              next.push(entry);
              replaced = true;
            }
            continue;
          }
          next.push(e);
        }
        if (!replaced && entry) next.push(entry);
        if (next.length === 0) {
          const copy = { ...prev };
          delete copy[imageId];
          return copy;
        }
        return { ...prev, [imageId]: { entries: next } };
      });
    },
    [],
  );

  const deleteMask = useCallback(
    (target: MaskIdentity) => {
      const current = segments[target.imageId];
      if (!current) return;
      const key = target.tag.toLowerCase();
      const ready = current.entries.find(
        (e): e is TagSegment & { status: 'ready' } =>
          e.status === 'ready' && e.tag.toLowerCase() === key,
      );
      if (!ready) return;
      if (
        target.maskIndex < 0 ||
        target.maskIndex >= ready.response.masks.length
      ) {
        return;
      }

      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: { ...ready.response, masks: [...ready.response.masks] },
      };
      const remaining = ready.response.masks.filter(
        (_, idx) => idx !== target.maskIndex,
      );
      const after: ReadyMaskEntry | null =
        remaining.length > 0
          ? {
              tag: ready.tag,
              status: 'ready',
              response: { ...ready.response, masks: remaining },
            }
          : null;

      const entry = deleteMaskEntry({
        projectId,
        imageId: target.imageId,
        tag: ready.tag,
        before,
        after,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      setSelectedMask(null);
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [segments, replaceReadyTag, history, projectId, setConn],
  );

  const deleteAllMasksForTag = useCallback(
    (imageId: string, tag: string) => {
      const current = segmentsRef.current[imageId];
      if (!current) return;
      const key = tag.toLowerCase();
      const ready = current.entries.find(
        (e): e is TagSegment & { status: 'ready' } =>
          e.status === 'ready' && e.tag.toLowerCase() === key,
      );
      if (!ready) return;

      const before: ReadyMaskEntry = {
        tag: ready.tag,
        status: 'ready',
        response: { ...ready.response, masks: [...ready.response.masks] },
      };

      const entry = deleteMaskEntry({
        projectId,
        imageId,
        tag: ready.tag,
        before,
        after: null,
        replaceTag: replaceReadyTag,
        onConn: setConn,
      });
      setSoloTag((prev) =>
        prev && prev.toLowerCase() === key ? null : prev,
      );
      setSelectedMask((prev) =>
        prev && prev.imageId === imageId && prev.tag.toLowerCase() === key
          ? null
          : prev,
      );
      entry.do();
      history.push(entry, { alreadyApplied: true });
    },
    [replaceReadyTag, history, projectId, setConn],
  );

  const removeSegmentTag = useCallback(
    (id: string, tag: string) => {
      const key = tag.toLowerCase();
      let remainingTags: string[] = [];
      let nothingLeft = false;
      let removed = false;
      setSegments((prev) => {
        const current = prev[id];
        if (!current) return prev;
        const remaining = current.entries.filter(
          (e) => e.tag.toLowerCase() !== key,
        );
        if (remaining.length === current.entries.length) return prev;
        removed = true;
        remainingTags = remaining.map((e) => e.tag);
        if (remaining.length === 0) {
          nothingLeft = true;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return { ...prev, [id]: { entries: remaining } };
      });
      if (!removed) return;
      // A late in-flight response for this exact tag is harmless: updateTag
      // maps over existing entries and no-ops once the tag is gone. Other
      // tags on the same image may still be loading — do NOT bump the
      // sequence or their responses would be dropped too.
      if (nothingLeft) {
        deleteAllSegmentationsForImage(projectId, id).catch((e) =>
          console.warn('[sam3] tag-remove persist failed', id, tag, e),
        );
      } else {
        deleteSegmentationsForImage(projectId, id, remainingTags).catch((e) =>
          console.warn('[sam3] tag-remove persist failed', id, tag, e),
        );
      }
    },
    [projectId],
  );

  const submitSegment = useCallback(
    (m: CanvasMedia, tags: string[]) => {
      if (m.kind !== 'image') return;
      if (!sam3Available) return;
      // De-dupe case-insensitively, keeping the first-seen casing as the
      // tag's canonical identity — the pill, the mask, and the bbox all
      // key off this exact string via colorForTag.
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of tags) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(t);
      }
      if (cleaned.length === 0) {
        clearSegment(m.id);
        return;
      }
      if (!m.collectionId || !m.file) {
        console.warn('[sam3] segment skipped — missing pb metadata for', m.id);
        return;
      }
      const seq = (segmentSeqRef.current[m.id] ?? 0) + 1;
      segmentSeqRef.current[m.id] = seq;
      // Submits are incremental — merge new tags onto existing masks.
      // Preserve existing ready entries so their masks stay rendered;
      // drop prior loading/error entries whose old invoke would be
      // orphaned by the seq bump, and re-invoke any that reappear.
      const mergedByKey = new Map<string, TagSegment>();
      for (const e of segments[m.id]?.entries ?? []) {
        if (e.status === 'ready') mergedByKey.set(e.tag.toLowerCase(), e);
      }
      const tagsToInvoke: string[] = [];
      for (const tag of cleaned) {
        const key = tag.toLowerCase();
        if (mergedByKey.has(key)) continue;
        mergedByKey.set(key, { tag, status: 'loading' });
        tagsToInvoke.push(tag);
      }
      const nextEntries: TagSegment[] = Array.from(mergedByKey.values());
      setSegments((prev) => ({ ...prev, [m.id]: { entries: nextEntries } }));

      const updateTag = (tag: string, patch: TagSegment) => {
        if (segmentSeqRef.current[m.id] !== seq) return;
        setSegments((prev) => {
          const current = prev[m.id];
          if (!current) return prev;
          return {
            ...prev,
            [m.id]: {
              entries: current.entries.map((entry) =>
                entry.tag === tag ? patch : entry,
              ),
            },
          };
        });
      };

      // Each tag is a separate prompt — SAM3 is single-object per call
      // and the worker queues concurrent invokes server-side.
      for (const tag of tagsToInvoke) {
        invoke<SegmentResponse>('sam3_segment_text', {
          id: m.id,
          collectionId: m.collectionId,
          file: m.file,
          text: tag,
        })
          .then((response) => {
            updateTag(tag, { tag, status: 'ready', response });
            // Fire-and-forget: persist the mask so it rehydrates after
            // reload. UI state is authoritative within a session; PB is
            // authoritative across sessions.
            upsertSegmentation(projectId, {
              image: m.id,
              tag,
              masks: response.masks,
              source_width: response.source_width,
              source_height: response.source_height,
            }).catch((e) => console.warn('[sam3] persist failed', tag, e));
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[sam3] segment failed for ${m.id} (${tag})`, err);
            updateTag(tag, { tag, status: 'error', message });
          });
      }
    },
    [clearSegment, sam3Available, segments, projectId],
  );

  const dispatchBoxPrompt = useCallback(
    (
      imageId: string,
      boxId: string,
      label: string,
      relBox: [number, number, number, number],
      imageW: number,
      imageH: number,
    ) => {
      if (!sam3Available) return;
      const m = mediaRef.current?.find((it) => it.id === imageId);
      if (!m || m.kind !== 'image' || !m.collectionId || !m.file) return;
      if (imageW <= 0 || imageH <= 0) return;
      const tag = label;
      const norm: [number, number, number, number] = [
        Math.max(0, Math.min(1, relBox[0] / imageW)),
        Math.max(0, Math.min(1, relBox[1] / imageH)),
        Math.max(0, Math.min(1, relBox[2] / imageW)),
        Math.max(0, Math.min(1, relBox[3] / imageH)),
      ];
      if (norm[2] <= norm[0] || norm[3] <= norm[1]) return;

      // Box entries keyed by boxId (not lowercase tag) so duplicate labels
      // don't clobber each other.
      const seq = segmentSeqRef.current[imageId] ?? 0;
      const updateEntry = (patch: TagSegment) => {
        if ((segmentSeqRef.current[imageId] ?? 0) !== seq) return;
        setSegments((prev) => {
          const cur = prev[imageId] ?? { entries: [] };
          const next: TagSegment[] = [];
          let replaced = false;
          for (const e of cur.entries) {
            if (e.kind === 'box' && e.boxId === boxId) {
              next.push(patch);
              replaced = true;
            } else {
              next.push(e);
            }
          }
          if (!replaced) next.push(patch);
          return { ...prev, [imageId]: { entries: next } };
        });
      };

      updateEntry({ tag, status: 'loading', kind: 'box', boxId });

      invoke<SegmentResponse>('sam3_segment_box', {
        id: imageId,
        collectionId: m.collectionId,
        file: m.file,
        bbox: norm,
      })
        .then((response) => {
          updateEntry({ tag, status: 'ready', response, kind: 'box', boxId });
          // Remove the user-drawn rectangle — its only job was to carry the
          // prompt and show the loading scan. Now that the mask is ready,
          // BboxOverlayLayer renders the segmentation's tight-fit bbox
          // (same chrome as text-prompt segments), so keeping the userBox
          // would duplicate it.
          setUserBoxes((prev) => {
            const list = prev[imageId];
            if (!list) return prev;
            const next = list.filter((b) => b.id !== boxId);
            if (next.length === list.length) return prev;
            if (next.length === 0) {
              const copy = { ...prev };
              delete copy[imageId];
              return copy;
            }
            return { ...prev, [imageId]: next };
          });
          // Persist the mask under the user's label so it rehydrates after
          // reload. The user-drawn rectangle is still session-local; only
          // the resulting segmentation is durable.
          upsertSegmentation(projectId, {
            image: imageId,
            tag,
            masks: response.masks,
            source_width: response.source_width,
            source_height: response.source_height,
          }).catch((e) => console.warn('[sam3] persist failed', tag, e));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[sam3] segment box failed for ${imageId} (${boxId})`,
            err,
          );
          updateEntry({ tag, status: 'error', message, kind: 'box', boxId });
        });
    },
    [sam3Available, mediaRef, projectId, setUserBoxes],
  );

  const confirmPendingBoxLabel = useCallback(
    (rawLabel: string) => {
      const label = rawLabel.trim();
      if (!label) return;
      const p = pendingBoxLabel;
      if (!p) return;
      setUserBoxes((prev) => {
        const list = prev[p.imageId] ?? [];
        return {
          ...prev,
          [p.imageId]: [...list, { id: p.boxId, box: p.relBox, label }],
        };
      });
      // Box labels are NOT added to highlightInputs — that input is for
      // text-prompt tags the user types directly. Box entries still appear
      // in the MediaTagList (driven by `segments`), just not in the text
      // chip strip, so the two prompt surfaces stay conceptually separate.
      // DO register the label in saved-tags so it surfaces in autocomplete
      // for later text prompts. Surface failures — silently swallowing
      // breaks the Home label list and the saved-tags popover with no
      // diagnostic.
      rememberSavedTag(label).catch((err) =>
        console.warn('[box-prompt] rememberSavedTag failed', err),
      );
      dispatchBoxPrompt(p.imageId, p.boxId, label, p.relBox, p.imageW, p.imageH);
      setPendingBoxLabel(null);
    },
    [
      pendingBoxLabel,
      dispatchBoxPrompt,
      rememberSavedTag,
      setPendingBoxLabel,
      setUserBoxes,
    ],
  );

  const cancelPendingBoxLabel = useCallback(() => {
    setPendingBoxLabel(null);
  }, [setPendingBoxLabel]);

  return {
    segments,
    setSegments,
    segmentsRef,
    selectedMask,
    setSelectedMask,
    hoveredMask,
    soloTag,
    setSoloTag,
    handleMaskSelect,
    handleMaskHover,
    clearSegment,
    replaceReadyTag,
    deleteMask,
    deleteAllMasksForTag,
    removeSegmentTag,
    submitSegment,
    confirmPendingBoxLabel,
    cancelPendingBoxLabel,
  };
}
