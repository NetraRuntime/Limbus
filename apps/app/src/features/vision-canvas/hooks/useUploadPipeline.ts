import { useCallback, useRef, useState } from 'react';
import {
  createImage,
  createVideo,
  type ImageRecord,
  type VideoRecord,
} from '../../../lib/pb';
import {
  createEntry,
  type CanvasActionMeta,
  type HistoryMedia,
} from '../../../lib/canvasHistory';
import type { UseHistoryReturn } from '../../../lib/history';
import {
  fromImageRecord,
  fromVideoRecord,
  precacheImageEncoding,
  type CanvasMedia,
  type ConnState,
  type UploadPlan,
  type UploadStatus,
} from '../lib';

type Args = {
  projectId: string;
  sam3Available: boolean;
  setMedia: React.Dispatch<React.SetStateAction<CanvasMedia[]>>;
  setPriorityIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setConn: React.Dispatch<React.SetStateAction<ConnState>>;
  history: UseHistoryReturn<CanvasActionMeta>;
};

export type UploadPipeline = {
  uploadStatus: Record<string, UploadStatus>;
  encodingIds: Set<string>;
  runUploadPlan: (
    plan: UploadPlan[],
    onUploaded?: (draftId: string, record: ImageRecord | VideoRecord) => void,
  ) => Promise<void>;
  abortUpload: (id: string) => void;
};

export function useUploadPipeline({
  projectId,
  sam3Available,
  setMedia,
  setPriorityIds,
  setConn,
  history,
}: Args): UploadPipeline {
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadStatus>>({});
  const [encodingIds, setEncodingIds] = useState<Set<string>>(() => new Set());
  const uploadCtrlsRef = useRef<Record<string, AbortController>>({});

  const abortUpload = useCallback((id: string) => {
    uploadCtrlsRef.current[id]?.abort();
  }, []);

  const runUploadPlan = useCallback(
    (
      plan: UploadPlan[],
      onUploaded?: (draftId: string, record: ImageRecord | VideoRecord) => void,
    ): Promise<void> => {
      if (plan.length === 0) return Promise.resolve();
      setMedia((prev) => [...prev, ...plan.map((p) => p.draft)]);
      setUploadStatus((prev) => {
        const next = { ...prev };
        for (const p of plan) next[p.draft.id] = { phase: 'sending', pct: 0 };
        return next;
      });
      return Promise.all(
        plan.map(async (p) => {
          const onProgress = (pct: number) => {
            setUploadStatus((prev) => {
              if (!(p.draft.id in prev)) return prev;
              return {
                ...prev,
                [p.draft.id]: {
                  phase: pct >= 1 ? 'finalizing' : 'sending',
                  pct: Math.min(1, Math.max(0, pct)),
                },
              };
            });
          };
          const ctrl = new AbortController();
          uploadCtrlsRef.current[p.draft.id] = ctrl;
          try {
            const record =
              p.draft.kind === 'video'
                ? await createVideo(projectId, p.file, p.meta, onProgress, ctrl.signal)
                : await createImage(projectId, p.file, p.meta, onProgress, ctrl.signal);
            onUploaded?.(p.draft.id, record);
            const next =
              p.draft.kind === 'video' ? fromVideoRecord(record) : fromImageRecord(record);
            setMedia((prev) => prev.map((m) => (m.id === p.draft.id ? next : m)));
            setPriorityIds((prev) => {
              const out = new Set(prev);
              out.add(next.id);
              return out;
            });
            URL.revokeObjectURL(p.draft.src);
            setConn('ready');
            if (p.draft.kind === 'image' && sam3Available) {
              const imageRecord = record as ImageRecord;
              setEncodingIds((prev) => {
                const next = new Set(prev);
                next.add(imageRecord.id);
                return next;
              });
              void precacheImageEncoding(imageRecord).finally(() => {
                setEncodingIds((prev) => {
                  if (!prev.has(imageRecord.id)) return prev;
                  const next = new Set(prev);
                  next.delete(imageRecord.id);
                  return next;
                });
              });
            }
            history.push(
              createEntry({
                created: [next as HistoryMedia],
                setMedia,
                onConn: setConn,
              }),
              { alreadyApplied: true },
            );
          } catch (err) {
            if ((err as Error | null)?.name !== 'AbortError') {
              const message = (err as Error | null)?.message ?? 'upload failed';
              const responseBody = (err as Error & { responseBody?: string } | null)
                ?.responseBody;
              console.error('[pb] upload failed', {
                file: p.file.name,
                kind: p.draft.kind,
                size: p.file.size,
                type: p.file.type,
                message,
                responseBody,
                error: err,
              });
              setConn('offline');
              setUploadStatus((prev) => ({
                ...prev,
                [p.draft.id]: { phase: 'error', pct: 0, message },
              }));
              return;
            }
          } finally {
            delete uploadCtrlsRef.current[p.draft.id];
          }
          setUploadStatus((prev) => {
            if (!(p.draft.id in prev)) return prev;
            const next = { ...prev };
            delete next[p.draft.id];
            return next;
          });
        }),
      ).then(() => {});
    },
    [projectId, sam3Available, history, setMedia, setPriorityIds, setConn],
  );

  return { uploadStatus, encodingIds, runUploadPlan, abortUpload };
}
