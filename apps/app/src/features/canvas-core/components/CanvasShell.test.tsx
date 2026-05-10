import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { CanvasShell } from './CanvasShell';
import { useCanvasShell } from './CanvasShellContext';

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

class ImageDataMock {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CanvasShell slots', () => {
  it('renders slots wrapped by provider components', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('ImageData', ImageDataMock);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,test',
    );

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <section data-testid="wrapper">{children}</section>
    );

    render(
      <CanvasShell
        projectId="project-1"
        viewKey="test-view"
        project={null}
        panSpeed={1}
        zoomSensitivity={1}
        onOpenSettings={() => {}}
      >
        <Wrapper>
          <CanvasShell.Canvas>
            <div data-testid="canvas-slot">canvas</div>
          </CanvasShell.Canvas>
          <CanvasShell.Sidebar>
            <aside data-testid="sidebar-slot">sidebar</aside>
          </CanvasShell.Sidebar>
        </Wrapper>
      </CanvasShell>,
    );

    expect(await screen.findByTestId('canvas-slot')).toHaveTextContent('canvas');
    expect(screen.getByTestId('sidebar-slot')).toHaveTextContent('sidebar');
  });

  it('registers callback props without invoking them as state updaters', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('ImageData', ImageDataMock);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,test',
    );

    const dropHandler = vi.fn();
    const fitBoundsGetter = vi.fn(() => null);
    const backgroundPointerDown = vi.fn();

    function Registrar() {
      const shell = useCanvasShell();
      useEffect(() => {
        shell.setDropHandler(dropHandler);
        shell.setFitBoundsGetter(fitBoundsGetter);
        shell.setBackgroundPointerDown(backgroundPointerDown);
        return () => {
          shell.setDropHandler(null);
          shell.setFitBoundsGetter(null);
          shell.setBackgroundPointerDown(null);
        };
      }, [shell]);
      return null;
    }

    render(
      <CanvasShell
        projectId="project-1"
        viewKey="test-view"
        project={null}
        panSpeed={1}
        zoomSensitivity={1}
        onOpenSettings={() => {}}
      >
        <Registrar />
      </CanvasShell>,
    );

    await screen.findByLabelText('NetraRT');
    expect(dropHandler).not.toHaveBeenCalled();
    expect(fitBoundsGetter).not.toHaveBeenCalled();
    expect(backgroundPointerDown).not.toHaveBeenCalled();
  });
});