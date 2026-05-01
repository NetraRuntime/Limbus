import { useState } from 'react';
import { CanvasPage, CanvasShell } from '../canvas-core';
import {
  HIGHLIGHT_BOTTOM_INSET_PX,
  MediaListSidebar,
  MediaRenderLayer,
  SavedTagsPopover,
  TopHudExtra,
  useSam3Boot,
  VISION_VIEW_STORAGE_KEY,
  VisionCanvasModalsConnected,
  VisionCanvasProvider,
  VisionOverlays,
  VisionSearchPaletteConnected,
  type ConnState,
} from './';
import { BootCard } from '../../components/BootCard';
import { useSettings } from '../../hooks/useSettings';
import { focusHome } from '../../lib/windows';
import '../../App.css';

type VisionCanvasPageProps = { projectId: string };

export function VisionCanvasPage({ projectId }: VisionCanvasPageProps) {
  const { settings } = useSettings();
  const boot = useSam3Boot(settings.activeModel);

  if (boot.status === 'loading') {
    return (
      <BootCard
        spinner
        title="Loading SAM3 model…"
        subtitle="First launch loads the image encoder onto the GPU. This takes a few seconds."
      />
    );
  }
  if (boot.status === 'no-model') {
    return (
      <BootCard
        role="alert"
        title="No model active"
        subtitle="Install one from Home → Models."
        action={
          <button
            type="button"
            className="btn btn-md btn-primary"
            onClick={() => void focusHome()}
          >
            Open Home
          </button>
        }
      />
    );
  }
  const sam3Error = boot.status === 'error' ? boot.message : null;
  return <Inner projectId={projectId} sam3Error={sam3Error} />;
}

type InnerProps = { projectId: string; sam3Error: string | null };

function Inner({ projectId, sam3Error }: InnerProps) {
  const [conn, setConn] = useState<ConnState>('connecting');

  return (
    <CanvasPage
      projectId={projectId}
      viewKey={VISION_VIEW_STORAGE_KEY}
      searchAriaLabel="Search media (⌘K / Ctrl+K)"
      searchTitle="Search media (⌘K)"
      fitFocusOpts={{ bottomInset: HIGHLIGHT_BOTTOM_INSET_PX }}
      topHudExtra={<TopHudExtra conn={conn} sam3Error={sam3Error} />}
      appControlsLeading={<SavedTagsPopover projectId={projectId} />}
    >
      <VisionCanvasProvider conn={conn} setConn={setConn} sam3Error={sam3Error}>
        <CanvasShell.Canvas>
          <MediaRenderLayer />
        </CanvasShell.Canvas>
        <CanvasShell.Overlays>
          <VisionOverlays />
        </CanvasShell.Overlays>
        <CanvasShell.Sidebar>
          <MediaListSidebar />
        </CanvasShell.Sidebar>
        <CanvasShell.SearchPalette>
          <VisionSearchPaletteConnected />
        </CanvasShell.SearchPalette>
        <CanvasShell.Modals>
          <VisionCanvasModalsConnected />
        </CanvasShell.Modals>
      </VisionCanvasProvider>
    </CanvasPage>
  );
}
