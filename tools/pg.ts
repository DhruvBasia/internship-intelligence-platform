/**
 * A fresh Postgres (PGlite) with Supabase's auth stubs and InternIQ's migrations,
 * for tests and the local dev server.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgliteDb, SUPABASE_STUB_SQL } from '../src/server/platform/pgliteDb';

const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');

/** Migrations that need Supabase-only extensions (pg_cron, pg_net) are skipped here. */
export function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && !f.includes('cron'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

export async function createDatabase(dataDir?: string): Promise<PGlite> {
  const pg = new PGlite(dataDir);
  await pg.exec(SUPABASE_STUB_SQL);
  const done = await pg.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = 'jobs'`);
  if (!done.rows[0]?.n) await pg.exec(migrationSql());
  return pg;
}

export async function createAuthUser(pg: PGlite, id: string, email: string): Promise<void> {
  await pg.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing', [id, email]);
}

export function dbs(pg: PGlite, userId: string) {
  return { user: new PgliteDb(pg, 'user', userId), service: new PgliteDb(pg, 'service') };
}
