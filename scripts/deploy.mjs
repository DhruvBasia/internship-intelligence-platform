/**
 * Ship a new version of the server after `npm run setup` has been done once:
 * checks, builds and deploys the API function, and (with --db) pushes new
 * database migrations. The web app is published by GitHub Actions on push.
 *
 *   npm run deploy:server            function only
 *   npm run deploy:server -- --db    migrations too (asks for the database password if not cached)
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pub = JSON.parse(await readFile(join(root, 'deploy/public.json'), 'utf8').catch(() => '{}'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(pub.supabaseUrl ?? '')?.[1];
if (!ref) {
  console.error('deploy/public.json has no Supabase URL yet. Run `npm run setup` first.');
  process.exit(1);
}

run('npm', ['run', 'check']);
if (process.argv.includes('--db')) run('npx', ['supabase', 'db', 'push']);
run('npx', ['supabase', 'functions', 'deploy', 'api', '--project-ref', ref, '--no-verify-jwt', '--use-api']);

const res = await fetch(`https://${ref}.supabase.co/functions/v1/api/health`).catch(() => null);
const body = res ? await res.json().catch(() => ({})) : {};
console.log(body.ok ? `\nAPI is up (v${body.version}).` : `\nAPI health check: ${res ? JSON.stringify(body) : 'unreachable'}`);
