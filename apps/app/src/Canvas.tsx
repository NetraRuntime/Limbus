import { VisionCanvasPage } from './features/vision-canvas';
import { LlmCanvasPage } from './features/llm-canvas';
import type { ProjectKind } from './features/projects/types/project';

type Props = {
  projectId: string;
  kind: ProjectKind;
};

export function Canvas({ projectId, kind }: Props) {
  if (kind === 'llm') return <LlmCanvasPage projectId={projectId} />;
  return <VisionCanvasPage projectId={projectId} />;
}
