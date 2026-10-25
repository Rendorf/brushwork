import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { settingsStore } from './store/settings';
import { App } from './ui/App';
import './ui/styles.css';

// Test hook for end-to-end tests (the open editor is exposed as window.__bw).
if (import.meta.env.DEV) (window as unknown as { __bwSettings: typeof settingsStore }).__bwSettings = settingsStore;

// Keep iOS from zooming or scrolling the page itself.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

let onNeedRefresh: (apply: () => void) => void = () => {};
let onOfflineReady: () => void = () => {};
const updateSW = registerSW({
  onNeedRefresh: () => onNeedRefresh(() => updateSW(true)),
  onOfflineReady: () => onOfflineReady(),
});

createRoot(document.getElementById('root')!).render(
  // No StrictMode: its double-mounted effects would create and destroy the WebGL context twice.
  <App
    registerUpdates={(need, ready) => {
      onNeedRefresh = need;
      onOfflineReady = ready;
    }}
  />,
);
