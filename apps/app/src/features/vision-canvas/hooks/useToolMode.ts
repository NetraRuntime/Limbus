import { useEffect, useRef, useState } from 'react';
import type { CanvasTool } from '../components/MediaToolbar';

/**
 * Owns the active tool plus a stable ref-mirror for gesture handlers, and
 * mirrors the value to `document.body.dataset.canvasTool` so global CSS
 * (cursor, hover affordances) can react without prop drilling.
 */
export function useToolMode(initial: CanvasTool = 'drag') {
  const [tool, setTool] = useState<CanvasTool>(initial);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    document.body.dataset.canvasTool = tool;
    return () => {
      delete document.body.dataset.canvasTool;
    };
  }, [tool]);

  return { tool, setTool, toolRef };
}
