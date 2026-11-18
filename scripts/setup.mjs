/**
 * One-time setup of your own InternIQ server on Supabase. Run it in your own
 * terminal (it asks for passwords and secrets):
 *
 *   npx supabase login      (once: opens the browser to authorise the CLI)
 *   npm run setup
 *
 * It links your Supabase project, creates the database tables, stores the
 * server secrets, deploys the API function and writes deploy/public.json for
 * the web app. Safe to run again: existing secrets are kept, so data encrypted
 * with them stays readable.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS_FILE = join(root, 'private', 'server.env');
const PUBLIC_FILE = join(root, 'deploy', 'public.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const origWrite = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => {
  if (muted && !/\n/.test(s)) origWrite?.('*');
  else origWrite?.(s);
};

function ask(question, fallback = '') {
  return new Promise((resolve) => rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `, (a) => resolve(a.trim() || fallback)));
}

function askHidden(question) {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (a) => {
      muted = false;
      process.stdout.write('\n');
      resolve(a.trim());
    });
    muted = true;
  });
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} failed (exit ${r.status}). Fix the problem above and run npm run setup again.`);
}

async function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function gitRemotePages() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(r.stdout ?? '');
  return m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}/` : '';
}

async function main() {
  console.log('\nInternIQ server setup\n=====================\n');
  console.log('You need: a Supabase project (supabase.com, free), and a Google OAuth client (see docs/DEPLOY.md).\n');

  const existing = await readEnvFile(SECRETS_FILE);
  const pub = existsSync(PUBLIC_FILE) ? JSON.parse(await readFile(PUBLIC_FILE, 'utf8')) : {};

  const urlOrRef = await ask('Supabase project URL (Project Settings → API) or project ref', pub.supabaseUrl ?? '');
  const ref = (/https:\/\/([a-z0-9]{10,})\.supabase\.co/.exec(urlOrRef)?.[1] ?? urlOrRef).trim();
  if (!/^[a-z0-9]{10,}$/.test(ref)) throw new Error('That does not look like a Supabase project URL or ref.');
  const supabaseUrl = `https://${ref}.supabase.co`;
  const anonKey = await ask('Publishable key (Project Settings → API Keys → "Publishable key", or the legacy anon key)', pub.anonKey ?? '');
  if (!anonKey) throw new Error('The publishable key is required.');
  const appUrl = (await ask('Where the web app will live', pub.appUrl || gitRemotePages())).replace(/\/?$/, '/');
  const ownerEmail = (await ask('Your Google email (you become the owner/admin)', existing.INTERNIQ_OWNER_EMAIL ?? '')).toLowerCase();
  if (!/@/.test(ownerEmail)) throw new Error('Enter the Google email you will sign in with.');
  const operator = await ask('Your name, shown on the privacy page', pub.operator ?? '');
  const contact = await ask('Contact for students (email or link, optional)', pub.contact ?? '');

  console.log('\nGoogle OAuth client (Google Cloud → APIs & Services → Credentials). Leave empty to skip Gmail for now.');
  const googleClientId = await ask('Google client ID', existing.GOOGLE_CLIENT_ID ?? '');
  let googleClientSecret = existing.GOOGLE_CLIENT_SECRET ?? '';
  if (googleClientId) {
    const typed = await askHidden(`Google client secret${googleClientSecret ? ' (press Enter to keep the saved one)' : ''}`);
    if (typed) googleClientSecret = typed;
  }

  const secrets = {
    INTERNIQ_APP_URL: appUrl,
    INTERNIQ_ALLOWED_ORIGINS: existing.INTERNIQ_ALLOWED_ORIGINS ?? 'http://localhost:5178',
    INTERNIQ_OWNER_EMAIL: ownerEmail,
    INTERNIQ_ADMIN_EMAILS: existing.INTERNIQ_ADMIN_EMAILS || ownerEmail,
    // Never rotate this one: it decrypts the AI keys and Gmail tokens already stored.
    INTERNIQ_SECRETS_KEY: existing.INTERNIQ_SECRETS_KEY || randomBytes(32).toString('base64'),
    INTERNIQ_CRON_SECRET: existing.INTERNIQ_CRON_SECRET || randomBytes(24).toString('base64url'),
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
  };
  await mkdir(dirname(SECRETS_FILE), { recursive: true });
  await writeFile(SECRETS_FILE, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  await mkdir(dirname(PUBLIC_FILE), { recursive: true });
  await writeFile(PUBLIC_FILE, JSON.stringify({ supabaseUrl, anonKey, appUrl, operator, contact }, null, 2) + '\n');
  console.log(`\nSaved server secrets to private/server.env (git-ignored; keep a backup) and public settings to deploy/public.json.`);
  rl.close();

  run('npx', ['supabase', 'link', '--project-ref', ref]);
  run('npx', ['supabase', 'db', 'push']);
  run('npx', ['supabase', 'secrets', 'set', '--env-file', 'private/server.env', '--project-ref', ref]);
  run('node', ['scripts/build.mjs']);
  run('npx', ['supabase', 'functions', 'deploy', 'api', '--project-ref', ref, '--no-verify-jwt']);

  console.log('\nChecking the deployed API…');
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/api/health`);
    const body = await res.json();
    console.log(body.ok ? '  API is up.' : `  API reports problems: ${body.problems?.join('; ')}`);
  } catch (e) {
    console.log(`  Could not reach the API yet (${e.message}). It can take a minute after the first deploy.`);
  }

  console.log(`
Done with the server. Remaining one-time steps (details in docs/DEPLOY.md):

 1. Supabase → Authentication → URL Configuration
      Site URL:       ${appUrl}
      Redirect URLs:  ${appUrl}   and   http://localhost:5178/
 2. Supabase → Authentication → Sign In / Providers → Google: enable, paste the same client ID and secret.
 3. Google Cloud → your OAuth client → Authorized redirect URIs:
      ${supabaseUrl}/auth/v1/callback
      ${supabaseUrl}/functions/v1/api/gmail/callback
 4. Commit deploy/public.json and push; GitHub Pages publishes the web app (Settings → Pages → Source: GitHub Actions).
 5. Open ${appUrl}, sign in with ${ownerEmail}, then Owner dashboard → Turn on hourly automation.
`);
}

main().catch((e) => {
  rl.close();
  console.error(`\n${e.message}`);
  process.exit(1);
});
