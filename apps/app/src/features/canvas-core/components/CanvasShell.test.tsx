// @vitest-environment jsdom
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Liquid-glass needs real canvas/ImageData APIs jsdom lacks. It is purely a
// visual concern, unrelated to the slot mechanism under test.
const glassStub = { filterSvg: null, ref: { current: null }, style: {} };
vi.mock('../hooks/useCanvasGlass', () => ({
  useCanvasGlass: () => ({
    searchPillGlass: glassStub,
    statusPillGlass: glassStub,
    controlsPillGlass: glassStub,
    wordmarkGlass: glassStub,
    settingsPillGlass: glassStub,
  }),
}));

import { CanvasShell } from './CanvasShell';
import { useCanvasShell } from './CanvasShellContext';

// Simulates the provider components (CanvasPageProvider, VisionCanvasProvider)
// that sit between CanvasShell and its slot elements in real usage.
function ProviderWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const baseProps = {
  projectId: 'p1',
  viewKey: 'canvas-shell-test',
  project: null,
  panSpeed: 1,
  zoomSensitivity: 1,
  onOpenSettings: () => {},
};

describe('CanvasShell slots', () => {
  it('renders slot content nested inside a wrapper component', () => {
    render(
      <CanvasShell {...baseProps}>
        <ProviderWrapper>
          <CanvasShell.Sidebar>
            <div>SIDEBAR_CONTENT</div>
          </CanvasShell.Sidebar>
        </ProviderWrapper>
      </CanvasShell>,
    );

    expect(screen.queryByText('SIDEBAR_CONTENT')).not.toBeNull();
  });

  it('keeps slot content under the wrapping provider context', () => {
    const Ctx = createContext('default');
    function Consumer() {
      return <div>{useContext(Ctx)}</div>;
    }

    render(
      <CanvasShell {...baseProps}>
        <Ctx.Provider value="FROM_PROVIDER">
          <CanvasShell.Overlays>
            <Consumer />
          </CanvasShell.Overlays>
        </Ctx.Provider>
      </CanvasShell>,
    );

    expect(screen.queryByText('FROM_PROVIDER')).not.toBeNull();
  });

  it('stores a function passed to setDropHandler instead of invoking it', () => {
    const handler = vi.fn();
    function Registrar() {
      const { setDropHandler } = useCanvasShell();
      useEffect(() => {
        setDropHandler(handler);
      }, [setDropHandler]);
      return null;
    }

    render(
      <CanvasShell {...baseProps}>
        <Registrar />
      </CanvasShell>,
    );

    // A raw useState setter would call handler(prevState) as an updater.
    expect(handler).not.toHaveBeenCalled();
  });
});
