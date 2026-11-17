/**
 * Local dev harness: runs the REAL server bundle in a Node VM against in-memory
 * fakes of Apps Script services, and serves the real client with a
 * google.script.run shim that calls it over HTTP.
 *
 *   npm run dev              fixtures for every network call (offline, deterministic)
 *   npm run dev:live         real network: live job sources and your real AI key
 *   options: --port=5178 --latency=250 --demo (pre-filled profile, onboarded, refreshed)
 *
 * Data lives in memory and resets when the process restarts.
 */
import http from 'node:http';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { buildClient, buildServer } from './build.mjs';
import { createGasGlobals } from '../tools/gas-fakes.mjs';
import { fixtureFetch } from '../tools/fixtures.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : process.argv.includes(`--${name}`) ? true : fallback;
};
const PORT = Number(arg('port', 5178));
const LIVE = Boolean(arg('live', false));
const LATENCY = Number(arg('latency', 250));
const DEMO = Boolean(arg('demo', false));

const FETCH_CHILD = `
let input='';process.stdin.on('data',d=>input+=d).on('end',async()=>{
  const req=JSON.parse(input);
  try{const r=await fetch(req.url,{method:req.method.toUpperCase(),headers:req.headers,body:req.payload,redirect:'follow',signal:AbortSignal.timeout(60000)});
  process.stdout.write(JSON.stringify({status:r.status,text:await r.text()}));}
  catch(e){process.stdout.write(JSON.stringify({throws:String(e.message||e)}));}
});`;

function liveFetch(req) {
  const out = execFileSync(process.execPath, ['-e', FETCH_CHILD], { input: JSON.stringify(req), maxBuffer: 128 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8'));
}

const fetchImpl = (req) => {
  // Fake AI unless a live run is explicitly using a real key.
  if (!LIVE || (/generativelanguage/.test(req.url) && process.env.IIP_FAKE_AI)) return fixtureFetch(req);
  return liveFetch(req);
};

const { globals, state } = createGasGlobals({ fetchImpl, email: process.env.IIP_DEV_EMAIL || 'student@example.com' });
let ctx = null;
let clientHtml = '';

async function rebuild() {
  const [server, client] = await Promise.all([buildServer(), buildClient()]);
  const context = vm.createContext({ ...globals, console });
  vm.runInContext(server.code, context, { filename: 'Code.js' });
  ctx = context;
  clientHtml = client.html;
}

const SHIM = `<script>
(function(){
  var LAT=${LATENCY};
  function make(ok, fail){
    return new Proxy({}, { get: function(_, prop){
      if (prop === 'withSuccessHandler') return function(fn){ return make(fn, fail); };
      if (prop === 'withFailureHandler') return function(fn){ return make(ok, fn); };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        setTimeout(function(){
          fetch('/rpc/' + String(prop), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
            .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function(v){ ok && ok(v); }, function(e){ fail && fail(e); });
        }, LAT);
      };
    }});
  }
  window.google = { script: { run: make(null, null) } };
})();
</script>`;

function renderPage() {
  // doGet() reads index.html via HtmlService; give the fake the freshly built file.
  globals.HtmlService.createHtmlOutputFromFile = () => ({ getContent: () => clientHtml });
  const out = ctx.doGet();
  return out.getContent().replace('<head>', '<head>' + SHIM);
}

async function seedDemo() {
  ctx.saveProfile({
    name: 'Dhruv',
    school: 'GGSIPU EDC',
    degree: 'bachelors',
    gradYear: 2027,
    skills: ['Python', 'PyTorch', 'SQL', 'scikit-learn', 'Pandas', 'Docker', 'React', 'GIS'],
    targetRoles: ['Machine Learning', 'Data Science', 'AI Research', 'Software Engineering'],
    locations: ['India', 'Bengaluru', 'Remote'],
    workModes: ['remote', 'hybrid'],
    needsSponsorship: true,
    resumeText: 'B.Tech CSE (AI & DS), GGSIPU EDC, 2023-2027.\nProjects: geospatial fire-risk analysis (Python, GeoPandas, Leaflet); agentic blockchain security with LangGraph; cognitive load detection with computer vision (OpenCV, React).\nSkills: Python, PyTorch, TensorFlow, SQL, Pandas, NumPy, Docker, Git, React, LangChain.',
    links: { github: 'https://github.com/DhruvBasia', linkedin: '', portfolio: '' },
  });
  ctx.saveSettings({ sources: { boards: [{ ats: 'greenhouse', token: 'northwind', name: 'Northwind' }, { ats: 'lever', token: 'quanta', name: 'Quanta' }] } });
  ctx.setSecret('gemini', 'AIzaDEV-fake-key-0000000000000000');
  ctx.completeOnboarding();
  ctx.importStarterPack();
  const r = ctx.refreshNow();
  if (!r.ok) console.warn('demo refresh failed', r.error);
  // Some pipeline history so Pipeline and Insights have something to show.
  const jobs = ctx.listJobs().data.jobs.sort((a, b) => b.score - a.score);
  const plan = [
    ['applied', 6],
    ['interviewing', 2],
    ['saved', 5],
    ['rejected', 2],
    ['offer', 1],
  ];
  let i = 0;
  for (const [stage, n] of plan) for (let k = 0; k < n && i < jobs.length; k++) ctx.updateJob(jobs[i++].id, { stage });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      await rebuild();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(renderPage());
      return;
    }
    const m = /^\/rpc\/([A-Za-z]+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && m) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const fn = ctx?.[m[1]];
      if (typeof fn !== 'function' || m[1] === 'doGet' || m[1] === 'worker') {
        res.writeHead(404);
        res.end('unknown rpc');
        return;
      }
      const t0 = Date.now();
      const result = fn(...JSON.parse(body || '[]'));
      console.log(`rpc ${m[1].padEnd(20)} ${result?.ok === false ? 'ERR ' + result.error.code : 'ok '} ${Date.now() - t0}ms`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    if (req.method === 'POST' && req.url === '/__worker') {
      ctx.worker();
      res.end('ok');
      return;
    }
    if (req.method === 'GET' && req.url === '/__state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ props: Object.keys(state.props), triggers: state.triggers, mail: state.mail.map((m) => m.subject), fetches: state.fetches.length }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e?.stack ?? e));
  }
});

await rebuild();
if (DEMO) await seedDemo();
server.listen(PORT, () => {
  console.log(`InternIQ dev harness on http://localhost:${PORT}  (${LIVE ? 'LIVE network' : 'fixtures'}${DEMO ? ', demo data' : ''})`);
});
