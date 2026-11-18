/**
 * The Db port over PGlite (Postgres compiled to WebAssembly), for tests and the
 * local dev server. Each operation runs in its own transaction as the same
 * database role Supabase would use (authenticated or service_role), with the
 * same JWT claims, so row-level security behaves exactly as in production.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Db, Filter, Row, SelectOptions } from './db';
import { stripNul } from './db';

/** Minimal stand-ins for what Supabase provides before our migration runs. */
export const SUPABASE_STUB_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''), '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$f$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

export class PgliteDb implements Db {
  constructor(
    private readonly pg: PGlite,
    readonly role: 'user' | 'service',
    private readonly userId = '',
  ) {}

  private run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      const claims = this.role === 'user' ? { sub: this.userId, role: 'authenticated' } : { role: 'service_role' };
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.exec(`set local role ${this.role === 'user' ? 'authenticated' : 'service_role'}`);
      return fn(tx);
    });
  }

  private where(filters: Filter[], params: unknown[]): string {
    if (!filters.length) return '';
    const parts = filters.map((f) => {
      const col = ident(f.col);
      if (f.op === 'in') {
        params.push((Array.isArray(f.value) ? f.value : [f.value]).map(String));
        return `${col}::text = any($${params.length}::text[])`;
      }
      params.push(typeof f.value === 'boolean' ? String(f.value) : f.value);
      const sym = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[f.op];
      return `${col} ${sym} $${params.length}`;
    });
    return ' where ' + parts.join(' and ');
  }

  async select(table: string, opts: SelectOptions): Promise<Row[]> {
    const params: unknown[] = [];
    const cols = opts.columns?.length ? opts.columns.map(ident).join(', ') : '*';
    let sql = `select ${cols} from public.${ident(table)}${this.where(opts.filters, params)}`;
    if (opts.order?.length) sql += ' order by ' + opts.order.map((o) => `${ident(o.col)} ${o.desc ? 'desc' : 'asc'}`).join(', ');
    if (opts.limit !== undefined) sql += ` limit ${Math.max(0, Math.floor(opts.limit))}`;
    if (opts.offset) sql += ` offset ${Math.max(0, Math.floor(opts.offset))}`;
    return this.run(async (tx) => (await tx.query<Row>(sql, params)).rows);
  }

  /** Rows grouped by their key set: missing keys take column defaults, like PostgREST's missing=default. */
  private groups(rows: Row[]): { cols: string[]; rows: Row[] }[] {
    const out = new Map<string, { cols: string[]; rows: Row[] }>();
    for (const r of rows) {
      const cols = Object.keys(r).sort();
      const sig = cols.join(',');
      if (!out.has(sig)) out.set(sig, { cols, rows: [] });
      out.get(sig)!.rows.push(r);
    }
    return Array.from(out.values());
  }

  async insert(table: string, rows: Row[]): Promise<void> {
    for (const g of this.groups(rows)) {
      const cols = g.cols.map(ident).join(', ');
      const sql = `insert into public.${ident(table)} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)`;
      await this.run((tx) => tx.query(sql, [JSON.stringify(stripNul(g.rows))]));
    }
  }

  async upsert(table: string, rows: Row[], conflict: string[]): Promise<void> {
    for (const g of this.groups(rows)) {
      const cols = g.cols.map(ident).join(', ');
      const updates = g.cols.filter((c) => !conflict.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
      const sql =
        `insert into public.${ident(table)} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)` +
        ` on conflict (${conflict.map(ident).join(', ')}) ` +
        (updates.length ? `do update set ${updates.join(', ')}` : 'do nothing');
      await this.run((tx) => tx.query(sql, [JSON.stringify(stripNul(g.rows))]));
    }
  }

  async update(table: string, patch: Row, filters: Filter[]): Promise<void> {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    const params: unknown[] = [JSON.stringify(stripNul(patch))];
    const list = cols.map(ident).join(', ');
    const sql = `update public.${ident(table)} set (${list}) = (select ${list} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb))${this.where(filters, params)}`;
    await this.run((tx) => tx.query(sql, params));
  }

  async delete(table: string, filters: Filter[], returning?: string[]): Promise<Row[]> {
    if (!filters.length) throw new Error('Refusing to delete without a filter');
    const params: unknown[] = [];
    let sql = `delete from public.${ident(table)}${this.where(filters, params)}`;
    if (returning?.length) sql += ' returning ' + returning.map(ident).join(', ');
    return this.run(async (tx) => (await tx.query<Row>(sql, params)).rows);
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const names = Object.keys(args);
    const params = names.map((n) => args[n]);
    const sql = `select * from public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})`;
    const res = await this.run((tx) => tx.query<Row>(sql, params));
    // PostgREST returns a scalar for scalar functions and an array for set-returning ones.
    if (res.fields.length === 1 && res.fields[0]!.name === fn) return (res.rows[0]?.[fn] ?? null) as T;
    return res.rows as T;
  }
}
