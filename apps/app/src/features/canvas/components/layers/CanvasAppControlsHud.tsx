import { SavedTagsPopover } from '../../../../components/SavedTagsPopover';

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
    <div className="hud hud-top-right">
      <SavedTagsPopover projectId={projectId} />
      {glass.filterSvg}
      <div
        ref={glass.ref}
        className="btn-cluster is-liquid-glass"
        role="group"
        aria-label="App controls"
        style={glass.style}
      >
        <button
          className="btn-ghost"
          type="button"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          <i className="ri-settings-3-line" aria-hidden />
        </button>
      </div>
    </div>
  );
}
