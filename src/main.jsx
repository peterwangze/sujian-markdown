import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { warmUpCodeHighlight } from './editor/render-document.js'
import './style.css'

createRoot(document.getElementById('root')).render(<App />)

// Starting the code highlighter stops the page for about a second. It is
// started in a pause, so that neither the start nor the first document with
// code waits for it, and nobody who is working is interrupted.
const resting = 2000;
const idle = window.requestIdleCallback
  ? (work) => requestIdleCallback(work, { timeout: 10_000 })
  : (work) => setTimeout(work, 1000);
let lastInput = performance.now();
for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
  addEventListener(type, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}
(function whenResting() {
  if (performance.now() - lastInput < resting) return idle(whenResting);
  warmUpCodeHighlight();
})();
