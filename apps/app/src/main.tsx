import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'remixicon/fonts/remixicon.css';
import '@netrart/design-system/tokens.css';
import '@netrart/design-system/kit.css';
import '@netrart/design-system/responsive.css';
import '@netrart/design-system/global.css';
import './App.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
