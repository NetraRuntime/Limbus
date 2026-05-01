import { VisionCanvasPage } from './features/vision-canvas';
import { LlmCanvasPage } from './features/llm-canvas';
import type { ProjectKind } from './features/projects/types/project';

type Props = {
  projectId: string;
  kind: ProjectKind;
  sam3Error?: string | null;
};

export function Canvas({ projectId, kind, sam3Error = null }: Props) {
  if (kind === 'llm') return <LlmCanvasPage projectId={projectId} />;
  return <VisionCanvasPage projectId={projectId} sam3Error={sam3Error} />;
}
