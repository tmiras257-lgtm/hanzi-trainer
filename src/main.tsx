import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/*
 * The subset is preloaded in the document head, so its bytes are already in the
 * cache — but a font declared `font-display: block` is only handed to the layout
 * once something asks for it. Asking here means the first Chinese character to
 * appear is drawn in the right face immediately, with no fallback frame.
 */
if (typeof document !== 'undefined' && document.fonts) {
  Promise.all([
    document.fonts.load('400 16px "Noto Sans SC Subset"'),
    document.fonts.load('600 16px "Noto Sans SC Subset"'),
  ]).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
