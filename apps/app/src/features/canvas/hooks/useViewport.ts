import { useEffect, useState } from 'react';

export type Viewport = { w: number; h: number };

const initial: Viewport =
  typeof window !== 'undefined'
    ? { w: window.innerWidth, h: window.innerHeight }
    : { w: 0, h: 0 };

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(initial);
  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}
