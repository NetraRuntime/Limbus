import { useCallback, useRef, useState } from 'react';
import {
  scanDataTransfer,
  type MediaDescriptor,
  type ScanEvent,
  type ScanInput,
} from '../lib/mediaIngest';

export type ImportState = {
  open: boolean;
  phase: 'scanning' | 'ready' | 'error';
  descriptors: MediaDescriptor[];
  bytes: number;
  imageCount: number;
  videoCount: number;
  warning?: { code: 'cap-soft'; message: string };
  error?: {
    code: 'cap-hard' | 'cap-depth' | 'zip-malformed' | 'scan-failed' | 'aborted';
    message: string;
  };
  sourceLabel: string;
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
  sourceLabel: '',
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

    try {
      for await (const event of gen) {
        if (controller.signal.aborted) return;
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
    }
  }, []);

  return { state, start, cancel, close, setPendingPoint, getPendingPoint };
}

function applyEvent(prev: ImportState, event: ScanEvent): ImportState {
  switch (event.type) {
    case 'descriptor': {
      return {
        ...prev,
        descriptors: [...prev.descriptors, event.descriptor],
        bytes: prev.bytes + event.descriptor.size,
        imageCount:
          prev.imageCount + (event.descriptor.kind === 'image' ? 1 : 0),
        videoCount:
          prev.videoCount + (event.descriptor.kind === 'video' ? 1 : 0),
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
      return { ...prev, phase: 'ready' };
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
