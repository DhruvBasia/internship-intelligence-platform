/**
 * End-to-end harness: the real HTTP handler, real Postgres (PGlite) with the
 * real migration and row-level security, and fixture responses for every
 * outside service (job boards, Gemini, Google OAuth, Gmail, Supabase Auth).
 */
import type { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../src/server/edge/handler';
import type { Db } from '../src/server/platform/db';
import { readEnv, type Env } from '../src/server/platform/env';
import { PgliteDb } from '../src/server/platform/pgliteDb';
import { fixtureFetch } from './fixtures.mjs';
import { createAuthUser, createDatabase } from './pg';

export type FixtureFetch = (req: { url: string; method: string; headers: Record<string, string>; payload?: string }) => { status: number; text: string };

export interface InboxMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  internalDate: string;
}

export const TEST_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

let shared: Promise<PGlite> | null = null;

/** One database per test file; every boot() is a brand-new user in it. */
export function testDatabase(): Promise<PGlite> {
  shared ??= createDatabase();
  return shared;
}

export interface BootOptions {
  fetchImpl?: FixtureFetch;
  inbox?: () => InboxMessage[];
  email?: string;
  env?: Record<string, string>;
  /** Wrap the user's database handle (to inject failures). */
  wrapDb?: (db: Db) => Db;
}

export interface TestState {
  /** Every outbound URL the server fetched, in order. */
  fetched: string[];
  gmailQueries: number;
  revoked: string[];
}

function headerMap(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h ?? {}).forEach((v, k) => (out[k] = v));
  // Fixtures look headers up by their canonical spelling.
  if (out['x-goog-api-key']) out['x-goog-api-key'] = out['x-goog-api-key'];
  if (out.authorization) out.Authorization = out.authorization;
  return out;
}

export async function boot(opts: BootOptions = {}) {
  const pg = await testDatabase();
  await pg.exec('delete from public.source_cache');
  const userId = crypto.randomUUID();
  const email = opts.email ?? `${userId.slice(0, 8)}@student.example`;
  await createAuthUser(pg, userId, email);
  const state: TestState = { fetched: [], gmailQueries: 0, revoked: [] };
  const vars: Record<string, string> = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    INTERNIQ_APP_URL: 'https://app.example/interniq/',
    INTERNIQ_SECRETS_KEY: TEST_SECRETS_KEY,
    INTERNIQ_CRON_SECRET: 'cron-secret-for-tests',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    INTERNIQ_ADMIN_EMAILS: 'owner@student.example',
    INTERNIQ_OWNER_EMAIL: 'owner@student.example',
    ...opts.env,
  };
  const env: Env = readEnv((k) => vars[k]);
  const fixture = opts.fetchImpl ?? (fixtureFetch as FixtureFetch);
  const inbox = opts.inbox ?? (() => []);
  let handler: (req: Request) => Promise<Response>;

  const fakeFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    state.fetched.push(url);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

    // The function calling itself (cron fan-out).
    if (url.startsWith(env.functionUrl)) return handler(new Request(url, { method, headers: init.headers, body }));
    // Supabase Auth admin: delete user (cascades in the database).
    const del = /\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url);
    if (del && method === 'DELETE') {
      await pg.query('delete from auth.users where id = $1', [del[1]]);
      return json({});
    }
    // Google OAuth.
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(body ?? '');
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good-code'
          ? json({ access_token: 'ya29.test', refresh_token: '1//refresh-test', scope: `openid ${GMAIL_SCOPE}`, expires_in: 3599 })
          : json({ error: 'invalid_grant' }, 400);
      }
      return form.get('refresh_token') === '1//refresh-test' ? json({ access_token: 'ya29.test', expires_in: 3599 }) : json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      state.revoked.push(new URLSearchParams(body ?? '').get('token') ?? '');
      return json({});
    }
    // Gmail API.
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
      if (headerMap(init.headers).Authorization !== 'Bearer ya29.test') return json({ error: 'unauthenticated' }, 401);
      const rest = url.slice('https://gmail.googleapis.com/gmail/v1/users/me/'.length);
      if (rest === 'profile') return json({ emailAddress: email });
      if (rest.startsWith('messages?')) {
        state.gmailQueries++;
        const params = new URLSearchParams(rest.slice('messages?'.length));
        const days = Number(/newer_than:(\d+)d/.exec(params.get('q') ?? '')?.[1] ?? 3650);
        const cutoff = Date.now() - days * 86_400_000;
        const hits = inbox().filter((m) => Number(m.internalDate) >= cutoff).slice(0, Number(params.get('maxResults') ?? 100));
        return json({ messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })) });
      }
      const id = /^messages\/([^?]+)/.exec(rest)?.[1];
      const m = inbox().find((x) => x.id === id);
      if (!m) return json({ error: 'not found' }, 404);
      return json({
        id: m.id,
        threadId: m.threadId,
        snippet: m.body.slice(0, 120),
        internalDate: m.internalDate,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: m.from },
            { name: 'Subject', value: m.subject },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(m.body, 'utf8').toString('base64url') } }],
        },
      });
    }
    const r = fixture({ url, method: method.toLowerCase(), headers: headerMap(init.headers), payload: body });
    return new Response(r.text, { status: r.status });
  }) as typeof fetch;

  handler = createHandler({
    env,
    fetch: fakeFetch,
    userDb: (_token, uid) => {
      const db = new PgliteDb(pg, 'user', uid);
      return opts.wrapDb ? opts.wrapDb(db) : db;
    },
    serviceDb: () => new PgliteDb(pg, 'service'),
    verify: async (token) => {
      const [kind, id, mail] = token.split(':');
      return kind === 'test' && id && mail ? { id, email: mail } : null;
    },
  });

  const token = `test:${userId}:${email}`;

  async function request(path: string, init: RequestInit & { origin?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.origin) headers.set('Origin', init.origin);
    return handler(new Request(`https://test.supabase.co/functions/v1/api${path}`, { ...init, headers }));
  }

  async function callAs(tok: string, name: string, ...args: unknown[]): Promise<{ ok: boolean; data?: any; error?: { code: string; message: string } }> {
    const res = await request('/', {
      method: 'POST',
      origin: 'https://app.example',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: name, args }),
    });
    return (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } };
  }

  const call = (name: string, ...args: unknown[]) => callAs(token, name, ...args);

  async function ok(name: string, ...args: unknown[]): Promise<any> {
    const r = await call(name, ...args);
    if (!r.ok) throw new Error(`${name} failed: ${r.error?.code} ${r.error?.message}`);
    return r.data;
  }

  /** Run the hourly worker for this user, as the cron fan-out would. */
  async function runWorker(): Promise<any> {
    const res = await request('/cron', {
      method: 'POST',
      headers: { 'x-cron-secret': vars.INTERNIQ_CRON_SECRET!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return res.json();
  }

  /** Walk the Gmail consent flow with a fake Google. */
  async function connectGmail(code = 'good-code'): Promise<Response> {
    const { url } = await ok('connectGmail');
    const state = new URL(url).searchParams.get('state')!;
    return request(`/gmail/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  }

  async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query<T>(query, params)).rows;
  }

  return { userId, email, token, env, pg, state, request, call, callAs, ok, runWorker, connectGmail, sql };
}
