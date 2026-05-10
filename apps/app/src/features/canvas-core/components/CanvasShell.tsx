import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CanvasTitlebar } from './CanvasTitlebar';
import { CanvasTopHud } from './CanvasTopHud';
import { CanvasBottomHud } from './CanvasBottomHud';
import { CanvasAppControlsHud } from './CanvasAppControlsHud';
import { DropErrorToast } from './DropErrorToast';
import { useCanvasGlass } from '../hooks/useCanvasGlass';
import { useViewPersist } from '../hooks/useViewPersist';
import { useWindowKeydown } from '../hooks/useWindowKeydown';
import {
  InfiniteCanvas,
  type BackgroundPointerDown,
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from '../InfiniteCanvas';
import { getInitialView } from '../lib/canvasView';
import {
  CanvasShellProvider,
  useCanvasShell,
  type CanvasShellSlotName,
  type CanvasShellValue,
} from './CanvasShellContext';
import type { ProjectRecord } from '../../projects';

type FitFocusOpts = {
  padding?: number;
  bottomInset?: number;
  rightInset?: number;
  leftInset?: number;
};

type Props = {
  projectId: string;
  viewKey: string;
  project: ProjectRecord | null;
  panSpeed: number;
  zoomSensitivity: number;
  fitFocusOpts?: FitFocusOpts;
  searchAriaLabel?: string;
  searchTitle?: string;
  topHudExtra?: ReactNode;
  appControlsLeading?: ReactNode;
  onOpenSettings: () => void;
  children: ReactNode;
};

function makeSlot(name: CanvasShellSlotName) {
  const Slot = ({ children }: { children?: ReactNode }) => {
    const { slotTargets } = useCanvasShell();
    const target = slotTargets[name];
    return target ? createPortal(children, target) : null;
  };
  (Slot as { __slot?: CanvasShellSlotName }).__slot = name;
  Slot.displayName = `CanvasShell.${name[0]!.toUpperCase()}${name.slice(1)}`;
  return Slot;
}

const TOAST_DURATION_MS = 5000;

export function CanvasShell({
  projectId,
  viewKey,
  project,
  panSpeed,
  zoomSensitivity,
  fitFocusOpts,
  searchAriaLabel,
  searchTitle,
  topHudExtra,
  appControlsLeading,
  onOpenSettings,
  children,
}: Props) {
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const [view, setView] = useState<View>(() => getInitialView(viewKey));
  const [cursor, setCursor] = useState<WorldPoint | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropHandler, setDropHandler] = useState<
    ((dt: DataTransfer, p: WorldPoint) => void) | null
  >(null);
  const [fitBoundsGetter, setFitBoundsGetter] = useState<
    (() => WorldRect | null) | null
  >(null);
  const [backgroundPointerDown, setBackgroundPointerDown] = useState<
    ((e: BackgroundPointerDown) => void) | null
  >(null);
  const [canvasSlotTarget, setCanvasSlotTarget] = useState<HTMLDivElement | null>(null);
  const [overlaysSlotTarget, setOverlaysSlotTarget] = useState<HTMLDivElement | null>(null);
  const [sidebarSlotTarget, setSidebarSlotTarget] = useState<HTMLDivElement | null>(null);
  const [searchPaletteSlotTarget, setSearchPaletteSlotTarget] = useState<HTMLDivElement | null>(null);
  const [modalsSlotTarget, setModalsSlotTarget] = useState<HTMLDivElement | null>(null);

  const glass = useCanvasGlass();
  useViewPersist(viewKey, view);

  useEffect(() => {
    if (!dropError) return;
    const t = window.setTimeout(() => setDropError(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [dropError]);

  useWindowKeydown(
    (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    },
    { capture: true },
  );

  const handleChange = useCallback((v: View) => setView(v), []);
  const handlePointerWorld = useCallback(
    (p: (WorldPoint & { screenX: number; screenY: number }) | null) => {
      if (!p) {
        setCursor(null);
        return;
      }
      setCursor({ worldX: p.worldX, worldY: p.worldY });
    },
    [],
  );

  const setDropHandlerValue = useCallback(
    (fn: ((dt: DataTransfer, p: WorldPoint) => void) | null) => {
      setDropHandler(() => fn);
    },
    [],
  );

  const setFitBoundsGetterValue = useCallback(
    (fn: (() => WorldRect | null) | null) => {
      setFitBoundsGetter(() => fn);
    },
    [],
  );

  const setBackgroundPointerDownValue = useCallback(
    (fn: ((e: BackgroundPointerDown) => void) | null) => {
      setBackgroundPointerDown(() => fn);
    },
    [],
  );

  const slotTargets = useMemo(
    () => ({
      canvas: canvasSlotTarget,
      overlays: overlaysSlotTarget,
      sidebar: sidebarSlotTarget,
      searchPalette: searchPaletteSlotTarget,
      modals: modalsSlotTarget,
    }),
    [
      canvasSlotTarget,
      overlaysSlotTarget,
      sidebarSlotTarget,
      searchPaletteSlotTarget,
      modalsSlotTarget,
    ],
  );

  const value = useMemo<CanvasShellValue>(
    () => ({
      projectId,
      view,
      cursor,
      canvasRef,
      searchOpen,
      setSearchOpen,
      setDropError,
      setDropHandler: setDropHandlerValue,
      setFitBoundsGetter: setFitBoundsGetterValue,
      setBackgroundPointerDown: setBackgroundPointerDownValue,
      slotTargets,
    }),
    [
      projectId,
      view,
      cursor,
      searchOpen,
      setDropHandlerValue,
      setFitBoundsGetterValue,
      setBackgroundPointerDownValue,
      slotTargets,
    ],
  );

  return (
    <CanvasShellProvider value={value}>
      <CanvasTitlebar />
      <InfiniteCanvas
        ref={canvasRef}
        initial={getInitialView(viewKey)}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onDataTransferDrop={dropHandler ?? undefined}
        onBackgroundPointerDown={backgroundPointerDown ?? undefined}
        zoomSensitivity={zoomSensitivity}
        panSpeed={panSpeed}
      >
        <div ref={setCanvasSlotTarget} style={{ display: 'contents' }} />
      </InfiniteCanvas>

      <div ref={setOverlaysSlotTarget} style={{ display: 'contents' }} />
      <div ref={setSidebarSlotTarget} style={{ display: 'contents' }} />

      <CanvasTopHud
        glass={glass.wordmarkGlass}
        project={project}
        extra={topHudExtra}
      />

      <CanvasBottomHud
        searchPillGlass={glass.searchPillGlass}
        statusPillGlass={glass.statusPillGlass}
        controlsPillGlass={glass.controlsPillGlass}
        view={view}
        cursor={cursor}
        canvasRef={canvasRef}
        getFitBounds={fitBoundsGetter ?? (() => null)}
        fitFocusOpts={fitFocusOpts}
        searchAriaLabel={searchAriaLabel}
        searchTitle={searchTitle}
        onSearchOpen={() => setSearchOpen(true)}
      />

      <CanvasAppControlsHud
        glass={glass.settingsPillGlass}
        onOpenSettings={onOpenSettings}
        leading={appControlsLeading}
      />

      <DropErrorToast message={dropError} onDismiss={() => setDropError(null)} />

      <div ref={setSearchPaletteSlotTarget} style={{ display: 'contents' }} />
      <div ref={setModalsSlotTarget} style={{ display: 'contents' }} />
      {children}
    </CanvasShellProvider>
  );
}

CanvasShell.Canvas = makeSlot('canvas');
CanvasShell.Overlays = makeSlot('overlays');
CanvasShell.Sidebar = makeSlot('sidebar');
CanvasShell.SearchPalette = makeSlot('searchPalette');
CanvasShell.Modals = makeSlot('modals');
