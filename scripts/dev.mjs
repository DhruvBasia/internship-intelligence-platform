/**
 * Local dev server: the real server code (HTTP handler, Postgres via PGlite,
 * row-level security) with fixture job sources, a fake Gemini and a fake Gmail
 * inbox, plus the real client built in dev mode. Sign-in is simulated.
 *
 *   npm run dev            empty account (shows onboarding)
 *   npm run dev:demo       pre-filled profile, jobs, pipeline and inbox
 *   options: --port=5178 --latency=150
 *
 * Data lives in memory and resets when the process restarts.
 */
import { build } from 'esbuild';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildClient } from './build.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : process.argv.includes(`--${name}`) ? true : fallback;
};
const PORT = Number(arg('port', 5178));
const LATENCY = Number(arg('latency', 150));
const DEMO = Boolean(arg('demo', false));

// Bundle the dev backend (TypeScript) once; PGlite and node built-ins stay external.
const outDir = join(root, 'node_modules/.cache/interniq');
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, 'dev-app.mjs');
await build({
  entryPoints: [join(root, 'tools/dev-app.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: outFile,
  external: ['@electric-sql/pglite', 'node:*'],
  logLevel: 'warning',
});
const { createDevApp } = await import(pathToFileURL(outFile).href + `?t=${Date.now()}`);
const app = await createDevApp({ demo: DEMO });

let client = null;
async function rebuildClient() {
  client = await buildClient({ dev: true, config: { supabaseUrl: '', anonKey: '', appUrl: `http://localhost:${PORT}/`, operator: 'your dev server', contact: '' } });
}
await rebuildClient();

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      await rebuildClient();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(client.html);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { method, args } = JSON.parse(body || '{}');
      await new Promise((r) => setTimeout(r, LATENCY));
      const out = await app.handle(String(method), Array.isArray(args) ? args : []);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
      const r = await app.raw(url.pathname.slice(4) + url.search);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
      return;
    }
    const name = normalize(url.pathname).replace(/^[\\/]+/, '');
    if (client.files[name]) {
      res.writeHead(200, { 'content-type': TYPES[extname(name)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(client.files[name]);
      return;
    }
    if (/^[a-z0-9.-]+\.(html|css|svg)$/.test(name)) {
      try {
        const text = await readFile(join(root, 'src/client/public', name), 'utf8');
        res.writeHead(200, { 'content-type': TYPES[extname(name)] });
        res.end(text);
        return;
      } catch {
        /* fall through */
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Dev server error: ' + (e?.message ?? e));
  }
});

server.listen(PORT, () => {
  console.log(`InternIQ dev server on http://localhost:${PORT}  (${DEMO ? 'demo data' : 'empty account'}; fixtures, fake AI and fake Gmail)`);
});
