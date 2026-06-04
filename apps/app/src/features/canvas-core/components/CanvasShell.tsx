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
  type CanvasShellValue,
  type SlotName,
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

function makeSlot(name: SlotName) {
  const Slot = ({ children }: { children?: ReactNode }) => {
    const { slotTargets } = useCanvasShell();
    const target = slotTargets[name];
    // Portal keeps `children` in the React tree (so provider context above
    // the slot still reaches it) while rendering it into the shell region.
    // `target` is null on the first render, before the region ref attaches;
    // the ref callback then updates context and this re-renders.
    return target ? createPortal(children, target) : null;
  };
  Slot.displayName = `CanvasShell.${name[0]!.toUpperCase()}${name.slice(1)}`;
  return Slot;
}

const TOAST_DURATION_MS = 5000;

// Portal-target wrappers must not affect layout: `display: contents` makes
// the wrapper generate no box, so portaled content sits where the wrapper is.
const DISPLAY_CONTENTS = { display: 'contents' } as const;

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
  const [dropHandler, setDropHandlerState] = useState<
    ((dt: DataTransfer, p: WorldPoint) => void) | null
  >(null);
  const [fitBoundsGetter, setFitBoundsGetterState] = useState<
    (() => WorldRect | null) | null
  >(null);
  const [backgroundPointerDown, setBackgroundPointerDownState] = useState<
    ((e: BackgroundPointerDown) => void) | null
  >(null);
  const [slotTargets, setSlotTargets] = useState<
    Partial<Record<SlotName, HTMLElement | null>>
  >({});

  // These store callbacks. A raw setState would treat a function argument as
  // an updater and *call* it, so wrap to store the function value itself.
  const setDropHandler = useCallback(
    (fn: ((dt: DataTransfer, p: WorldPoint) => void) | null) =>
      setDropHandlerState(() => fn),
    [],
  );
  const setFitBoundsGetter = useCallback(
    (fn: (() => WorldRect | null) | null) => setFitBoundsGetterState(() => fn),
    [],
  );
  const setBackgroundPointerDown = useCallback(
    (fn: ((e: BackgroundPointerDown) => void) | null) =>
      setBackgroundPointerDownState(() => fn),
    [],
  );

  const setSlotTarget = useCallback((name: SlotName, el: HTMLElement | null) => {
    setSlotTargets((prev) => (prev[name] === el ? prev : { ...prev, [name]: el }));
  }, []);
  const slotRefs = useMemo(
    () => ({
      canvas: (el: HTMLElement | null) => setSlotTarget('canvas', el),
      overlays: (el: HTMLElement | null) => setSlotTarget('overlays', el),
      sidebar: (el: HTMLElement | null) => setSlotTarget('sidebar', el),
      searchPalette: (el: HTMLElement | null) =>
        setSlotTarget('searchPalette', el),
      modals: (el: HTMLElement | null) => setSlotTarget('modals', el),
    }),
    [setSlotTarget],
  );

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

  const value = useMemo<CanvasShellValue>(
    () => ({
      projectId,
      view,
      cursor,
      canvasRef,
      searchOpen,
      setSearchOpen,
      setDropError,
      setDropHandler,
      setFitBoundsGetter,
      setBackgroundPointerDown,
      slotTargets,
    }),
    [projectId, view, cursor, searchOpen, slotTargets],
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
        <div ref={slotRefs.canvas} style={DISPLAY_CONTENTS} />
      </InfiniteCanvas>

      <div ref={slotRefs.overlays} style={DISPLAY_CONTENTS} />
      <div ref={slotRefs.sidebar} style={DISPLAY_CONTENTS} />

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

      <div ref={slotRefs.searchPalette} style={DISPLAY_CONTENTS} />
      <div ref={slotRefs.modals} style={DISPLAY_CONTENTS} />

      {/*
        Mount the slot-bearing children (which include the feature providers).
        The providers' hooks run here; each slot portals its content into the
        region nodes above. Without this, the providers would never mount.
      */}
      {children}
    </CanvasShellProvider>
  );
}

CanvasShell.Canvas = makeSlot('canvas');
CanvasShell.Overlays = makeSlot('overlays');
CanvasShell.Sidebar = makeSlot('sidebar');
CanvasShell.SearchPalette = makeSlot('searchPalette');
CanvasShell.Modals = makeSlot('modals');
