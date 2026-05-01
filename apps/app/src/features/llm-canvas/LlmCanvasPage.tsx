import { CanvasPage, CanvasShell } from '../canvas-core';
import {
  LLM_VIEW_STORAGE_KEY,
  LlmCanvasModals,
  LlmCanvasProvider,
  LlmEdgeOverlay,
  LlmInspectorSidebar,
  LlmStartNodes,
  LlmStepNameOverlay,
  LlmStepNodes,
  LlmStepSearch,
} from './';
import '../../App.css';

type LlmCanvasPageProps = { projectId: string };

export function LlmCanvasPage({ projectId }: LlmCanvasPageProps) {
  return (
    <CanvasPage
      projectId={projectId}
      viewKey={LLM_VIEW_STORAGE_KEY}
      searchAriaLabel="Search steps (⌘K / Ctrl+K)"
      searchTitle="Search steps (⌘K)"
      modals={(m) => <LlmCanvasModals {...m} />}
    >
      <LlmCanvasProvider>
        <CanvasShell.Canvas>
          <LlmStartNodes />
          <LlmStepNodes />
          <LlmEdgeOverlay />
        </CanvasShell.Canvas>
        <CanvasShell.Overlays>
          <LlmStepNameOverlay />
        </CanvasShell.Overlays>
        <CanvasShell.Sidebar>
          <LlmInspectorSidebar />
        </CanvasShell.Sidebar>
        <CanvasShell.SearchPalette>
          <LlmStepSearch />
        </CanvasShell.SearchPalette>
      </LlmCanvasProvider>
    </CanvasPage>
  );
}
