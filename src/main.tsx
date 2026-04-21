import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import './styles/tokens.css';
import './styles/kit.css';
import './styles/reveal.css';
import './styles/responsive.css';
import './styles/global.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
