import { createContext, useContext, type RefObject } from 'react';
import type {
  BackgroundPointerDown,
  InfiniteCanvasHandle,
  View,
  WorldPoint,
  WorldRect,
} from '../InfiniteCanvas';

export type CanvasShellValue = {
  projectId: string;
  view: View;
  cursor: WorldPoint | null;
  canvasRef: RefObject<InfiniteCanvasHandle>;
  searchOpen: boolean;
  setSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setDropError: (message: string | null) => void;
  setDropHandler: (
    fn: ((dt: DataTransfer, p: WorldPoint) => void) | null,
  ) => void;
  setFitBoundsGetter: (fn: (() => WorldRect | null) | null) => void;
  setBackgroundPointerDown: (
    fn: ((e: BackgroundPointerDown) => void) | null,
  ) => void;
  slotTargets: CanvasShellSlotTargets;
};

export type CanvasShellSlotName =
  | 'canvas'
  | 'overlays'
  | 'sidebar'
  | 'searchPalette'
  | 'modals';

export type CanvasShellSlotTargets = Record<CanvasShellSlotName, HTMLElement | null>;

const CanvasShellContextRef = createContext<CanvasShellValue | null>(null);
CanvasShellContextRef.displayName = 'CanvasShellContext';

export const CanvasShellProvider = CanvasShellContextRef.Provider;

export function useCanvasShell(): CanvasShellValue {
  const value = useContext(CanvasShellContextRef);
  if (!value) {
    throw new Error('useCanvasShell must be used inside a CanvasShell.');
  }
  return value;
}
