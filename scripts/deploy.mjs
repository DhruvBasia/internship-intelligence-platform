/**
 * Check, build, push and deploy to Apps Script with clasp.
 *
 *   node scripts/deploy.mjs                 create a NEW deployment (new URL); prints its id
 *   node scripts/deploy.mjs <deploymentId>  update an existing deployment (URL stays the same)
 *
 * The deployment id can also come from INTERNIQ_DEPLOYMENT_ID.
 * Requires: clasp installed (npm i -g @google/clasp), `clasp login`, and a .clasp.json.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' });

if (!existsSync('.clasp.json')) {
  console.error('Missing .clasp.json. Run `clasp create-script --type webapp --title InternIQ --rootDir dist` or copy .clasp.json.example.');
  process.exit(1);
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const deploymentId = process.argv[2] || process.env.INTERNIQ_DEPLOYMENT_ID || '';
const description = `InternIQ v${version} (${new Date().toISOString().slice(0, 10)})`;

run('npm run check');
run('clasp push --force');
if (deploymentId) {
  run(`clasp update-deployment ${deploymentId} --description "${description}"`);
  console.log(`\nUpdated deployment ${deploymentId}. The web app URL is unchanged.`);
} else {
  const out = capture(`clasp create-deployment --description "${description}"`);
  process.stdout.write(out);
  console.log('\nNew deployment created. Reuse its id next time to keep the same URL:\n  node scripts/deploy.mjs <deploymentId>');
}
