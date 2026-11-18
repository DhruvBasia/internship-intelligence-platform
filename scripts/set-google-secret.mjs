/**
 * Store the Google OAuth client secret: asks for it with hidden input, saves it
 * in private/server.env (git-ignored) and sets it on the Supabase function.
 * Run it in your own terminal:  npm run secret:google
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS_FILE = join(root, 'private', 'server.env');
const pub = JSON.parse(await readFile(join(root, 'deploy/public.json'), 'utf8'));
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(pub.supabaseUrl ?? '')?.[1];
if (!ref || !existsSync(SECRETS_FILE)) {
  console.error('Run the server setup first (deploy/public.json and private/server.env are missing).');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => (muted && !/\n/.test(s) ? write?.('*') : write?.(s));
const secret = await new Promise((resolve) => {
  rl.question('Paste the Google client secret (it will show as *), then press Enter: ', (a) => {
    muted = false;
    process.stdout.write('\n');
    resolve(a.trim());
  });
  muted = true;
});
rl.close();
if (!/^GOCSPX-|^[A-Za-z0-9_-]{20,}$/.test(secret)) {
  console.error('That does not look like a Google client secret (they usually start with GOCSPX-). Nothing was changed.');
  process.exit(1);
}

const lines = (await readFile(SECRETS_FILE, 'utf8')).split(/\r?\n/).filter((l) => l && !l.startsWith('GOOGLE_CLIENT_SECRET='));
lines.push(`GOOGLE_CLIENT_SECRET=${secret}`);
await writeFile(SECRETS_FILE, lines.join('\n') + '\n', { mode: 0o600 });

// Set only this value on the function, from a temporary file (never on the command line).
const tmp = join(root, 'private', '.google-secret.env');
await writeFile(tmp, `GOOGLE_CLIENT_SECRET=${secret}\n`, { mode: 0o600 });
const r = spawnSync('npx', ['supabase', 'secrets', 'set', '--env-file', 'private/.google-secret.env', '--project-ref', ref], { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
await rm(tmp, { force: true });
if (r.status !== 0) {
  console.error('\nCould not store the secret on Supabase. It is saved in private/server.env; run this again after fixing the error above.');
  process.exit(1);
}
console.log('\nSaved. Now paste the same secret into Supabase → Authentication → Sign In / Providers → Google → Client Secret, and click Save.');
