import { useCallback, useEffect, type RefObject } from 'react';
import {
  buildDescriptorFromFile,
  captureDataTransfer,
  dropContainsFolderOrZip,
  scanTauriPaths,
  type MediaDescriptor,
} from '../../../lib/mediaIngest';
import { subscribeTauriDrops } from '../../../lib/tauriDragDrop';
import type {
  AnnotationFormat,
  AnnotationPlan,
} from '../../../lib/annotations';
import type {
  InfiniteCanvasHandle,
  WorldPoint,
} from '../../canvas-core';
import type { ImageRecord, VideoRecord } from '../../../lib/pb';
import { useImportPreview } from '../../../hooks/useImportPreview';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  applyAnnotationPlanToCanvas,
  describeDrop,
  makeImageIdCollector,
  prepareImportPlan,
  type CanvasMedia,
  type SegmentState,
  type UploadPlan,
} from '../lib';

type Args = {
  projectId: string;
  canvasRef: RefObject<InfiniteCanvasHandle>;
  mediaRef: RefObject<CanvasMedia[]>;
  runUploadPlan: (
    plan: UploadPlan[],
    onUploaded?: (
      draftId: string,
      record: ImageRecord | VideoRecord,
    ) => void,
  ) => Promise<void>;
  setSegments: React.Dispatch<React.SetStateAction<Record<string, SegmentState>>>;
};

export type DropHandler = {
  preview: ReturnType<typeof useImportPreview>;
  handleDrop: (dt: DataTransfer, point: WorldPoint) => void;
  onConfirmImport: () => void;
};

export function useDropHandler({
  projectId,
  canvasRef,
  mediaRef,
  runUploadPlan,
  setSegments,
}: Args): DropHandler {
  const preview = useImportPreview();

  const importDescriptors = useCallback(
    async (
      descriptors: MediaDescriptor[],
      point: WorldPoint,
      annotationPlan: AnnotationPlan | null = null,
      chosenFormat: AnnotationFormat | 'none' = 'none',
    ) => {
      const prepared = await prepareImportPlan(
        descriptors,
        point,
        mediaRef.current ?? [],
      );
      if (!prepared) return;
      const { plan, descriptorByDraftId, focusRect } = prepared;

      const imageIdByDescriptorPath = new Map<string, string>();
      const onUploaded = makeImageIdCollector(
        descriptorByDraftId,
        imageIdByDescriptorPath,
      );

      const uploading = runUploadPlan(plan, onUploaded);
      canvasRef.current?.focusOn(focusRect, {
        bottomInset: HIGHLIGHT_BOTTOM_INSET_PX,
      });
      await uploading;

      if (!annotationPlan || chosenFormat === 'none') return;
      await applyAnnotationPlanToCanvas({
        projectId,
        plan: annotationPlan,
        chosenFormat,
        descriptors,
        imageIdByDescriptorPath,
        setSegments,
      });
    },
    [canvasRef, mediaRef, projectId, runUploadPlan, setSegments],
  );

  const handleDrop = useCallback(
    (dt: DataTransfer, point: WorldPoint) => {
      const captured = captureDataTransfer(dt);
      if (
        captured.entries.length === 0 &&
        captured.fallbackFiles.length === 0
      ) {
        return;
      }
      if (!dropContainsFolderOrZip(captured)) {
        void (async () => {
          const budget = {
            bytesUsed: 0,
            limit: Number.MAX_SAFE_INTEGER,
          };
          const descs: MediaDescriptor[] = [];
          for (const f of captured.fallbackFiles) {
            const d = await buildDescriptorFromFile(f, f.name, budget);
            descs.push(...d);
          }
          // Most browsers expose drops via webkitGetAsEntry, populating
          // entries instead of fallbackFiles. The folder/zip gate above
          // already excluded directory entries, so anything left here is
          // a single FileSystemFileEntry we can resolve to a File.
          for (const entry of captured.entries) {
            if (!entry || !entry.isFile) continue;
            const fileEntry = entry as FileSystemFileEntry;
            const file = await new Promise<File>((resolve, reject) =>
              fileEntry.file(resolve, reject),
            );
            const d = await buildDescriptorFromFile(file, file.name, budget);
            descs.push(...d);
          }
          if (descs.length) await importDescriptors(descs, point);
        })();
        return;
      }

      preview.setPendingPoint(point);
      void preview.start({
        kind: 'data-transfer',
        captured,
        label: describeDrop(captured),
      });
    },
    [importDescriptors, preview],
  );

  const onConfirmImport = useCallback(() => {
    const point = preview.getPendingPoint();
    const descs = preview.state.descriptors;
    const plan = preview.state.annotationPlan;
    const format = preview.state.chosenFormat;
    preview.close();
    if (point && descs.length) {
      void importDescriptors(descs, point, plan, format);
    }
  }, [importDescriptors, preview]);

  useEffect(() => {
    return subscribeTauriDrops(({ paths, position }) => {
      if (!paths.length) return;
      const rect = document.documentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const clientX = position.x / dpr;
      const clientY = position.y / dpr;
      const view = canvasRef.current?.getView();
      if (!view) return;
      const worldX = (clientX - rect.left - view.x) / view.scale;
      const worldY = (clientY - rect.top - view.y) / view.scale;
      const point: WorldPoint = { worldX, worldY };
      preview.setPendingPoint(point);

      // Tauri drops always go through scanTauriPaths — scan_paths classifies
      // files vs folders reliably (no extension-heuristic misroutes).
      const label =
        paths.length === 1
          ? (paths[0]!.split(/[\\/]/).pop() ?? paths[0]!)
          : `${paths.length} sources`;
      void preview.start({
        kind: 'generator',
        label,
        makeGenerator: (signal) => scanTauriPaths(paths, signal),
      });
    });
  }, [canvasRef, preview]);

  return { preview, handleDrop, onConfirmImport };
}
