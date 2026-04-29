import { useCallback, useState, type RefObject } from 'react';
import type { InfiniteCanvasHandle } from '../../canvas-core';

export type Connecting = {
  fromNodeId: string;
  toX: number;
  toY: number;
};

export type Naming = { x: number; y: number };

type Args = {
  canvasRef: RefObject<InfiniteCanvasHandle>;
};

/**
 * Drags a bezier from a node's right port to the cursor; on pointer-up
 * the drop point becomes `naming`, used by the StepNameInput overlay.
 *
 * `connecting` stays set while naming so the bezier remains on screen.
 */
export function useConnectGesture({ canvasRef }: Args) {
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);

  const start = useCallback(
    (fromNodeId: string, worldPoint: { x: number; y: number }) => {
      setConnecting({
        fromNodeId,
        toX: worldPoint.x,
        toY: worldPoint.y,
      });

      let lastWorld = { x: worldPoint.x, y: worldPoint.y };
      const onMove = (e: PointerEvent) => {
        const v = canvasRef.current?.getView();
        if (!v) return;
        const worldX = (e.clientX - v.x) / v.scale;
        const worldY = (e.clientY - v.y) / v.scale;
        lastWorld = { x: worldX, y: worldY };
        setConnecting((prev) =>
          prev ? { ...prev, toX: worldX, toY: worldY } : prev,
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setNaming(lastWorld);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [canvasRef],
  );

  const cancel = useCallback(() => {
    setNaming(null);
    setConnecting(null);
  }, []);

  return { connecting, naming, start, cancel, setConnecting, setNaming };
}
