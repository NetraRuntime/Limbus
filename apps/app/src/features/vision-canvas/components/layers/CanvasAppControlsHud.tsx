import { CanvasAppControlsHud as BaseCanvasAppControlsHud } from '../../../canvas-core';
import { SavedTagsPopover } from '../SavedTagsPopover';

type GlassRender = {
  filterSvg: React.ReactNode;
  ref: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
};

type Props = {
  projectId: string;
  glass: GlassRender;
  onOpenSettings: () => void;
};

export function CanvasAppControlsHud({
  projectId,
  glass,
  onOpenSettings,
}: Props) {
  return (
    <BaseCanvasAppControlsHud
      glass={glass}
      onOpenSettings={onOpenSettings}
      leading={<SavedTagsPopover projectId={projectId} />}
    />
  );
}
