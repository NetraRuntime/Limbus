import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  type InfiniteCanvasHandle,
  type View,
  type WorldPoint,
  type WorldRect,
} from '../InfiniteCanvas';
import { getInitialView } from '../lib/canvasView';
import {
  CanvasShellProvider,
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
  getFitBounds: () => WorldRect | null;
  fitFocusOpts?: FitFocusOpts;
  searchAriaLabel?: string;
  searchTitle?: string;
  topHudExtra?: ReactNode;
  onOpenSettings: () => void;
  children: ReactNode;
};

type SlotName = 'canvas' | 'overlays' | 'sidebar' | 'searchPalette' | 'modals';

function pickSlot(children: ReactNode, name: SlotName): ReactNode {
  let found: ReactNode = null;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const tag = (child.type as { __slot?: SlotName }).__slot;
    if (tag === name) {
      found = (child.props as { children?: ReactNode }).children ?? null;
    }
  });
  return found;
}

function makeSlot(name: SlotName) {
  const Slot = ({ children }: { children?: ReactNode }) => <>{children}</>;
  (Slot as { __slot?: SlotName }).__slot = name;
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
  getFitBounds,
  fitFocusOpts,
  searchAriaLabel,
  searchTitle,
  topHudExtra,
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
    }),
    [projectId, view, cursor, searchOpen],
  );

  const canvasSlot = pickSlot(children, 'canvas');
  const overlaysSlot = pickSlot(children, 'overlays');
  const sidebarSlot = pickSlot(children, 'sidebar');
  const paletteSlot = pickSlot(children, 'searchPalette');
  const modalsSlot = pickSlot(children, 'modals');

  return (
    <CanvasShellProvider value={value}>
      <CanvasTitlebar />
      <InfiniteCanvas
        ref={canvasRef}
        initial={getInitialView(viewKey)}
        onChange={handleChange}
        onPointerWorld={handlePointerWorld}
        onDataTransferDrop={dropHandler ?? undefined}
        zoomSensitivity={zoomSensitivity}
        panSpeed={panSpeed}
      >
        {canvasSlot}
      </InfiniteCanvas>

      {overlaysSlot}
      {sidebarSlot}

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
        getFitBounds={getFitBounds}
        fitFocusOpts={fitFocusOpts}
        searchAriaLabel={searchAriaLabel}
        searchTitle={searchTitle}
        onSearchOpen={() => setSearchOpen(true)}
      />

      <CanvasAppControlsHud
        glass={glass.settingsPillGlass}
        onOpenSettings={onOpenSettings}
      />

      <DropErrorToast message={dropError} onDismiss={() => setDropError(null)} />

      {paletteSlot}
      {modalsSlot}
    </CanvasShellProvider>
  );
}

CanvasShell.Canvas = makeSlot('canvas');
CanvasShell.Overlays = makeSlot('overlays');
CanvasShell.Sidebar = makeSlot('sidebar');
CanvasShell.SearchPalette = makeSlot('searchPalette');
CanvasShell.Modals = makeSlot('modals');
