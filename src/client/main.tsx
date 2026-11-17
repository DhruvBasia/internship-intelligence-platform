import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { applyTheme, loadBoot, loaded, theme, view, type View } from './state';

declare global {
  interface Window {
    __IIP_STARTED__?: boolean;
    __IIP_SHOW_ERROR__?: (msg: string) => void;
  }
}

try {
  // Deep links for the local harness and screenshots (?view=insights&theme=dark).
  // Inside Apps Script the page runs in a sandboxed frame, so these are inert there.
  const params = new URLSearchParams(location.search);
  const v = params.get('view');
  if (v && ['home', 'calendar', 'mail', 'discover', 'pipeline', 'insights', 'studies', 'exams', 'settings'].includes(v)) view.value = v as View;
  const t = params.get('theme');
  applyTheme(t === 'light' || t === 'dark' ? t : theme.value);
  render(<App />, document.getElementById('app')!);
  // Once the real app has rendered, later errors must not replace it with the startup error screen.
  const stop = loaded.subscribe((ok) => {
    if (ok) {
      setTimeout(() => (window.__IIP_STARTED__ = true), 0);
      stop();
    }
  });
  void loadBoot();
} catch (e) {
  window.__IIP_SHOW_ERROR__?.(e instanceof Error ? e.stack || e.message : String(e));
}
