import type { ReactNode } from 'react';

type GlassRender = {
  filterSvg: React.ReactNode;
  ref: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
};

type Props = {
  glass: GlassRender;
  onOpenSettings: () => void;
  /** Optional content rendered before the settings cluster (e.g. project-specific popovers). */
  leading?: ReactNode;
};

export function CanvasAppControlsHud({ glass, onOpenSettings, leading }: Props) {
  return (
    <div className="hud hud-top-right">
      {leading}
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
