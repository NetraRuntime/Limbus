import { useEffect } from 'react';
import { Landing } from './landing/Landing';
import { Canvas } from './Canvas';
import { useRoute } from './router';

export function App() {
  const { route } = useRoute();

  // Scope the viewport scroll lock to the canvas route — landing should scroll.
  useEffect(() => {
    const cls = 'is-canvas';
    if (route === '/app') document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [route]);

  if (route === '/app') return <Canvas />;
  return <Landing />;
}
