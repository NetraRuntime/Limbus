import { useEffect } from 'react';
import { Canvas } from './Canvas';

export function App() {
  useEffect(() => {
    document.body.classList.add('is-canvas');
    return () => document.body.classList.remove('is-canvas');
  }, []);

  return <Canvas />;
}
