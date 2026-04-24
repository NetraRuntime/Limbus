import { useCallback, useRef, useState } from 'react';
import {
  scanDataTransfer,
  type MediaDescriptor,
  type ScanEvent,
  type ScanInput,
} from '../lib/mediaIngest';
import { detectAnnotations } from '../lib/annotations';
import type { AnnotationFormat, AnnotationPlan } from '../lib/annotations';

export type ImportState = {
  open: boolean;
  phase: 'scanning' | 'detecting' | 'ready' | 'error';
  descriptors: MediaDescriptor[];
  bytes: number;
  imageCount: number;
  videoCount: number;
  annotationCount: number;
  warning?: { code: 'cap-soft'; message: string };
  error?: {
    code: 'cap-hard' | 'cap-depth' | 'zip-malformed' | 'scan-failed' | 'aborted';
    message: string;
  };
  sourceLabel: string;
  annotationPlan: AnnotationPlan | null;
  chosenFormat: AnnotationFormat | 'none';
};

export type ScanSource =
  | { kind: 'data-transfer'; captured: ScanInput; label: string }
  | {
      kind: 'generator';
      label: string;
      makeGenerator: (signal: AbortSignal) => AsyncGenerator<ScanEvent>;
    };

const EMPTY: ImportState = {
  open: false,
  phase: 'ready',
  descriptors: [],
  bytes: 0,
  imageCount: 0,
  videoCount: 0,
  annotationCount: 0,
  sourceLabel: '',
  annotationPlan: null,
  chosenFormat: 'none',
};

export function useImportPreview() {
  const [state, setState] = useState<ImportState>(EMPTY);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingPointRef = useRef<{ worldX: number; worldY: number } | null>(null);

  const close = useCallback(() => {
    pendingPointRef.current = null;
    setState(EMPTY);
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    pendingPointRef.current = null;
    setState(EMPTY);
  }, []);

  const setPendingPoint = useCallback(
    (p: { worldX: number; worldY: number } | null) => {
      pendingPointRef.current = p;
    },
    [],
  );

  const getPendingPoint = useCallback(
    () => pendingPointRef.current,
    [],
  );

  const start = useCallback(async (source: ScanSource) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({
      ...EMPTY,
      open: true,
      phase: 'scanning',
      sourceLabel: source.label,
    });

    const gen: AsyncGenerator<ScanEvent> =
      source.kind === 'data-transfer'
        ? scanDataTransfer(source.captured, controller.signal)
        : source.makeGenerator(controller.signal);

    const accumulated: MediaDescriptor[] = [];
    let sawScanError = false;

    try {
      for await (const event of gen) {
        if (controller.signal.aborted) return;
        if (event.type === 'descriptor') accumulated.push(event.descriptor);
        if (event.type === 'error') sawScanError = true;
        setState((prev) => applyEvent(prev, event));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: {
          code: 'scan-failed',
          message: (err as Error).message || 'scan failed',
        },
      }));
      return;
    }

    if (sawScanError) return;

    try {
      const plan = await detectAnnotations(accumulated);
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: 'ready',
        annotationPlan: plan,
        chosenFormat: plan.format === 'mixed' ? 'none' : plan.format,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        phase: 'error',
        error: {
          code: 'scan-failed',
          message: (err as Error).message || 'annotation detection failed',
        },
      }));
    }
  }, []);

  const setChosenFormat = useCallback((f: AnnotationFormat | 'none') => {
    setState((prev) => ({ ...prev, chosenFormat: f }));
  }, []);

  return { state, start, cancel, close, setPendingPoint, getPendingPoint, setChosenFormat };
}

function applyEvent(prev: ImportState, event: ScanEvent): ImportState {
  switch (event.type) {
    case 'descriptor': {
      const d = event.descriptor;
      return {
        ...prev,
        descriptors: [...prev.descriptors, d],
        bytes: prev.bytes + d.size,
        imageCount: prev.imageCount + (d.kind === 'image' ? 1 : 0),
        videoCount: prev.videoCount + (d.kind === 'video' ? 1 : 0),
        annotationCount: prev.annotationCount + (d.kind === 'annotation' ? 1 : 0),
      };
    }
    case 'progress':
      return prev; // counts already updated via descriptor events
    case 'warning':
      return {
        ...prev,
        warning: {
          code: 'cap-soft',
          message: `This will import ${event.count} items (~${humanSize(event.bytes)}). Uploads may take several minutes.`,
        },
      };
    case 'done':
      return { ...prev, phase: 'detecting' };
    case 'error':
      return {
        ...prev,
        phase: 'error',
        error: { code: event.code, message: event.message },
      };
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
