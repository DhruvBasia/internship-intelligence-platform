/**
 * The storage port. The app only needs a handful of operations, so it speaks to
 * Postgres through this small interface:
 *
 * - PostgrestDb (production): Supabase's REST API. Requests made with the
 *   signed-in user's token are filtered by row-level security in the database,
 *   so even a bug here cannot touch another user's rows.
 * - PgliteDb (tests, local dev; tools/): the same schema and policies running in
 *   WebAssembly Postgres.
 */
export type Op = 'eq' | 'neq' | 'in' | 'lt' | 'lte' | 'gt' | 'gte';

export interface Filter {
  col: string;
  op: Op;
  value: string | number | boolean | (string | number)[];
}

export interface Order {
  col: string;
  desc?: boolean;
}

export interface SelectOptions {
  filters: Filter[];
  columns?: string[];
  order?: Order[];
  limit?: number;
  offset?: number;
}

export type Row = Record<string, unknown>;

export interface Db {
  readonly role: 'user' | 'service';
  /** All matching rows (paged internally when no limit is given). */
  select(table: string, opts: SelectOptions): Promise<Row[]>;
  insert(table: string, rows: Row[]): Promise<void>;
  /** Insert, or update every given column on conflict with `conflict`. */
  upsert(table: string, rows: Row[], conflict: string[]): Promise<void>;
  update(table: string, patch: Row, filters: Filter[]): Promise<void>;
  /** Delete matching rows; returns the requested columns of deleted rows. */
  delete(table: string, filters: Filter[], returning?: string[]): Promise<Row[]>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

/** Postgres rejects NUL in text and jsonb; scraped pages occasionally contain it. */
export function stripNul<T>(value: T): T {
  if (typeof value === 'string') return (value.includes('\u0000') ? value.replace(/\u0000/g, '') : value) as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripNul(v);
    return out as T;
  }
  return value;
}

/** Split rows into batches that stay well under request-size limits. */
export function batches<T>(rows: T[], maxRows = 400, maxBytes = 900_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of rows) {
    const size = JSON.stringify(r).length;
    if (cur.length && (cur.length >= maxRows || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

const PAGE = 1000;
const IN_CHUNK = 80;

function quoteIn(v: string | number): string {
  const s = String(v);
  return /^[A-Za-z0-9_\-.:@]+$/.test(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** PostgREST query-string form of the filters. Exported for tests. */
export function filterParams(filters: Filter[], params = new URLSearchParams()): URLSearchParams {
  for (const f of filters) {
    if (f.op === 'in') {
      const values = (Array.isArray(f.value) ? f.value : [f.value as string]).map((v) => quoteIn(v as string | number));
      params.append(f.col, `in.(${values.join(',')})`);
    } else {
      params.append(f.col, `${f.op}.${String(f.value)}`);
    }
  }
  return params;
}

/** Large IN lists are split so URLs stay short. */
function splitIn(filters: Filter[]): Filter[][] {
  const idx = filters.findIndex((f) => f.op === 'in' && Array.isArray(f.value) && f.value.length > IN_CHUNK);
  if (idx < 0) return [filters];
  const values = filters[idx]!.value as (string | number)[];
  const out: Filter[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const copy = filters.slice();
    copy[idx] = { ...filters[idx]!, value: values.slice(i, i + IN_CHUNK) };
    out.push(copy);
  }
  return out;
}

export interface PostgrestOptions {
  url: string;
  apiKey: string;
  /** User access token; omit for the service role. */
  userToken?: string;
  fetch?: typeof fetch;
}

export class PostgrestDb implements Db {
  readonly role: 'user' | 'service';
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PostgrestOptions) {
    this.role = opts.userToken ? 'user' : 'service';
    this.base = opts.url.replace(/\/+$/, '') + '/rest/v1';
    const bearer = opts.userToken ?? (opts.apiKey.startsWith('eyJ') ? opts.apiKey : '');
    this.headers = { apikey: opts.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (bearer) this.headers.Authorization = `Bearer ${bearer}`;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async send(method: string, path: string, init: { body?: unknown; prefer?: string[] } = {}): Promise<unknown> {
    const headers: Record<string, string> = { ...this.headers };
    if (init.prefer?.length) headers.Prefer = init.prefer.join(',');
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await this.fetchImpl(this.base + path, {
          method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
      } catch (e) {
        if (attempt === 2) throw new DbError(`Database unreachable: ${e instanceof Error ? e.message : String(e)}`, 0, 'NETWORK');
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      // Retry only on gateway hiccups; Postgres errors are not transient.
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      break;
    }
    const text = await res!.text();
    if (!res!.ok) {
      let message = text.slice(0, 300);
      let code = String(res!.status);
      try {
        const err = JSON.parse(text) as { message?: string; code?: string; hint?: string };
        message = err.message ?? message;
        code = err.code ?? code;
      } catch {
        /* not JSON */
      }
      throw new DbError(message, res!.status, code);
    }
    return text ? JSON.parse(text) : null;
  }

  async select(table: string, opts: SelectOptions): Promise<Row[]> {
    const out: Row[] = [];
    for (const filters of splitIn(opts.filters)) {
      const params = filterParams(filters);
      params.set('select', opts.columns?.length ? opts.columns.join(',') : '*');
      if (opts.order?.length) params.set('order', opts.order.map((o) => `${o.col}.${o.desc ? 'desc' : 'asc'}`).join(','));
      if (opts.limit !== undefined) {
        params.set('limit', String(opts.limit));
        if (opts.offset) params.set('offset', String(opts.offset));
        out.push(...((await this.send('GET', `/${table}?${params}`)) as Row[]));
        continue;
      }
      // Supabase caps responses at 1000 rows: page until a short page comes back.
      for (let offset = opts.offset ?? 0; ; offset += PAGE) {
        params.set('limit', String(PAGE));
        params.set('offset', String(offset));
        const page = (await this.send('GET', `/${table}?${params}`)) as Row[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
    }
    return out;
  }

  async insert(table: string, rows: Row[]): Promise<void> {
    for (const chunk of batches(rows.map(stripNul))) {
      await this.send('POST', `/${table}`, { body: chunk, prefer: ['return=minimal', 'missing=default'] });
    }
  }

  async upsert(table: string, rows: Row[], conflict: string[]): Promise<void> {
    for (const chunk of batches(rows.map(stripNul))) {
      await this.send('POST', `/${table}?on_conflict=${conflict.join(',')}`, {
        body: chunk,
        prefer: ['resolution=merge-duplicates', 'return=minimal', 'missing=default'],
      });
    }
  }

  async update(table: string, patch: Row, filters: Filter[]): Promise<void> {
    await this.send('PATCH', `/${table}?${filterParams(filters)}`, { body: stripNul(patch), prefer: ['return=minimal'] });
  }

  async delete(table: string, filters: Filter[], returning?: string[]): Promise<Row[]> {
    if (!filters.length) throw new DbError('Refusing to delete without a filter', 0, 'GUARD');
    const out: Row[] = [];
    for (const f of splitIn(filters)) {
      const params = filterParams(f);
      if (returning?.length) {
        params.set('select', returning.join(','));
        out.push(...((await this.send('DELETE', `/${table}?${params}`, { prefer: ['return=representation'] })) as Row[]));
      } else {
        await this.send('DELETE', `/${table}?${params}`, { prefer: ['return=minimal'] });
      }
    }
    return out;
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return (await this.send('POST', `/rpc/${fn}`, { body: args })) as T;
  }
}
