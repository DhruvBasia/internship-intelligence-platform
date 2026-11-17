import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { applyTheme, loadBoot, theme, view, type View } from './state';

// Deep links for the local harness and screenshots (?view=insights&theme=dark).
// Inside Apps Script the page runs in a sandboxed iframe, so these are inert there.
const params = new URLSearchParams(location.search);
const v = params.get('view');
if (v && ['home', 'discover', 'pipeline', 'insights', 'settings'].includes(v)) view.value = v as View;
const t = params.get('theme');
applyTheme(t === 'light' || t === 'dark' ? t : theme.value);
render(<App />, document.getElementById('app')!);
void loadBoot();
