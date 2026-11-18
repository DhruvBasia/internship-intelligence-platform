import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles.css';
import { App } from './App';
import { initAuth, session } from './auth';
import { applyTheme, loadBoot, loaded, navigate, readHash, scanMailNow, theme, toast, view } from './state';
import { Landing } from './views/Landing';

declare global {
  interface Window {
    __IIP_STARTED__?: boolean;
    __IIP_SHOW_ERROR__?: (msg: string) => void;
  }
}

let booting = false;

/** After Google sends the student back from the Gmail consent screen. */
function handleReturnFromGmail(): void {
  const { view: v, params } = readHash();
  if (v !== 'mail' || !params.has('gmail')) return;
  navigate('mail');
  if (params.get('gmail') === 'connected') {
    toast('Gmail connected. Reading your recent placement emails…');
    void scanMailNow();
  } else {
    toast(params.get('reason') || 'Gmail was not connected.', 'error');
  }
}

function Root() {
  const s = session.value;
  useEffect(() => {
    if (s && !booting && !loaded.value) {
      booting = true;
      void loadBoot().then(() => {
        booting = false;
        if (loaded.value) handleReturnFromGmail();
      });
    }
  }, [s]);
  if (s === undefined) {
    return (
      <div class="boot" role="status">
        <div class="boot-mark" aria-hidden="true">
          IQ
        </div>
        <p>Starting InternIQ…</p>
      </div>
    );
  }
  if (s === null) return <Landing />;
  return <App />;
}

try {
  const fromHash = readHash().view;
  if (fromHash) view.value = fromHash;
  const params = new URLSearchParams(location.search);
  const t = params.get('theme');
  applyTheme(t === 'light' || t === 'dark' ? t : theme.value);
  window.addEventListener('hashchange', () => {
    const v = readHash().view;
    if (v && v !== view.value) view.value = v;
  });
  render(<Root />, document.getElementById('app')!);
  // Once the real app has rendered, later errors must not replace it with the startup error screen.
  const stop = session.subscribe((s) => {
    if (s !== undefined) {
      setTimeout(() => (window.__IIP_STARTED__ = true), 0);
      stop();
    }
  });
  void initAuth().catch((e) => {
    window.__IIP_SHOW_ERROR__?.(e instanceof Error ? e.stack || e.message : String(e));
  });
} catch (e) {
  window.__IIP_SHOW_ERROR__?.(e instanceof Error ? e.stack || e.message : String(e));
}
