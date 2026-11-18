/**
 * HTTP entry point (one Supabase Edge Function named "api"):
 *
 *   OPTIONS *                 CORS preflight (only the app's own origins)
 *   GET  /health              configuration check
 *   POST /                    RPC: { method, args } with the user's access token
 *   GET  /gmail/callback      Google OAuth redirect after "Connect Gmail"
 *   POST /cron                hourly fan-out (shared secret), or { userId } for one user
 *   GET  /ics/<token>.ics     private calendar feed for Google / Apple Calendar
 */
import { DEFAULT_SETTINGS, mergeSettings, APP_VERSION } from '../../shared/defaults';
import { buildEvents, icsCalendar } from '../../shared/calendar';
import type { DeepPartial, ErrorCode, RpcResult, Settings } from '../../shared/types';
import { runWorker } from '../automation';
import { errorMessage } from '../errors';
import { log } from '../log';
import { completeGmailConnect } from '../mail/gmail';
import type { AuthUser } from '../platform/auth';
import { isolated, runWithCtx, verifyIsolation, type RequestCtx } from '../platform/context';
import { safeEqual } from '../platform/crypto';
import type { Db } from '../platform/db';
import { envProblems, type Env } from '../platform/env';
import { pool } from '../platform/http';
import { invoke, isMethod } from '../rpc';
import { localDayHour } from '../runtime';
import { jobsTable, toSummary } from '../store/jobs';
import { examsTable, programsTable, tasksTable } from '../store/records';
import { closeSession, openSession } from '../store/session';
import { saveSettings } from '../store/userState';

export interface AppDeps {
  env: Env;
  fetch: typeof fetch;
  userDb(token: string, userId: string): Db;
  serviceDb(): Db;
  verify(token: string): Promise<AuthUser | null>;
  /** Keep the isolate alive for background work after responding (Supabase EdgeRuntime.waitUntil). */
  waitUntil?(p: Promise<unknown>): void;
}

const MAX_BODY = 2_000_000;

export function createHandler(deps: AppDeps): (req: Request) => Promise<Response> {
  const { env } = deps;
  const ready = verifyIsolation().then((ok) => {
    if (!ok) log.error('context.isolation_failed', {});
  });

  function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('origin') ?? '';
    if (!origin || !env.allowedOrigins.includes(origin)) return { Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }

  const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
    });

  const fail = (code: ErrorCode, message: string, status: number, headers: Record<string, string>) =>
    json({ ok: false, error: { code, message } } satisfies RpcResult<never>, status, headers);

  function serviceSession(userId: string): Promise<RequestCtx> {
    const service = deps.serviceDb();
    return openSession({ userId, db: service, service, env, fetch: deps.fetch });
  }

  async function handleRpc(req: Request, cors: Record<string, string>): Promise<Response> {
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim() ?? '';
    if (!token) return fail('UNAUTHENTICATED', 'Please sign in.', 401, cors);
    let user: AuthUser | null;
    try {
      user = await deps.verify(token);
    } catch (e) {
      log.error('auth.verify_failed', { message: errorMessage(e) });
      return fail('BUSY', 'Sign-in service is busy. Try again in a moment.', 503, cors);
    }
    if (!user) return fail('UNAUTHENTICATED', 'Your session expired. Please sign in again.', 401, cors);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail('BAD_INPUT', 'That request is too large.', 413, cors);
    let body: { method?: unknown; args?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return fail('BAD_INPUT', 'Malformed request.', 400, cors);
    }
    if (!isMethod(body.method)) return fail('BAD_INPUT', 'Unknown method.', 400, cors);
    const method = body.method;
    const args = Array.isArray(body.args) ? body.args : [];

    let c: RequestCtx;
    try {
      c = await openSession({ userId: user.id, email: user.email, db: deps.userDb(token, user.id), service: deps.serviceDb(), env, fetch: deps.fetch });
    } catch (e) {
      log.error('session.open_failed', { message: errorMessage(e) });
      return fail('BUSY', 'The server is busy right now. Please try again in a moment.', 503, cors);
    }
    if (c.profile.blocked) return fail('FORBIDDEN', 'This account has been suspended. Contact the person who shared InternIQ with you.', 403, cors);
    const result = await isolated(() => runWithCtx(c, () => invoke(method, args)));
    return json(result, 200, cors);
  }

  async function handleGmailCallback(url: URL): Promise<Response> {
    const back = (q: string) => {
      if (!env.appUrl) return new Response('Gmail connection finished. You can close this tab.', { status: 200 });
      return new Response(null, { status: 302, headers: { Location: `${env.appUrl.replace(/#.*$/, '')}#/mail?${q}`, 'Cache-Control': 'no-store' } });
    };
    try {
      const service = deps.serviceDb();
      const out = await completeGmailConnect(env, deps.fetch, service, url.searchParams);
      if (!out.ok) return back(`gmail=error&reason=${encodeURIComponent(out.reason)}`);
      const c = await serviceSession(out.userId);
      await runWithCtx(c, async () => {
        saveSettings({ mail: { enabled: true } });
        await closeSession(c);
      });
      return back('gmail=connected');
    } catch (e) {
      log.error('gmail.callback_failed', { message: errorMessage(e) });
      return back(`gmail=error&reason=${encodeURIComponent('Something went wrong while connecting Gmail. Try again.')}`);
    }
  }

  async function runForUser(userId: string): Promise<string[]> {
    const c = await serviceSession(userId);
    if (c.profile.blocked) return [];
    return isolated(() =>
      runWithCtx(c, async () => {
        try {
          return await runWorker();
        } finally {
          await closeSession(c);
        }
      }),
    );
  }

  async function handleCron(req: Request): Promise<Response> {
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!env.cronSecret || !safeEqual(secret, env.cronSecret)) return json({ ok: false }, 401);
    let body: { userId?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      /* empty body: dispatch */
    }
    if (body.userId) {
      try {
        const did = await runForUser(body.userId);
        log.info('cron.user_done', { did });
        return json({ ok: true, did }, 200);
      } catch (e) {
        log.error('cron.user_failed', { message: errorMessage(e) });
        return json({ ok: false }, 500);
      }
    }
    const due = await deps.serviceDb().rpc<{ user_id: string; settings: DeepPartial<Settings>; gmail: boolean }[]>('interniq_due_users', {});
    const targets = due.filter((u) => {
      if (u.gmail) return true;
      const s = mergeSettings(DEFAULT_SETTINGS, u.settings ?? {});
      const { hour } = localDayHour(s.automation.timezone);
      // From the chosen hour on; the worker itself skips users already refreshed today.
      return s.automation.enabled && hour >= s.automation.hour;
    });
    const work = pool(targets, 4, (u) =>
      deps
        .fetch(`${env.functionUrl}/cron`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.cronSecret },
          body: JSON.stringify({ userId: u.user_id }),
        })
        .then((r) => r.status)
        .catch(() => 0),
    );
    if (deps.waitUntil) deps.waitUntil(work);
    else await work;
    log.info('cron.dispatched', { due: due.length, targets: targets.length });
    return json({ ok: true, dispatched: targets.length }, 200);
  }

  async function handleIcs(token: string): Promise<Response> {
    const rows = await deps.serviceDb().select('profiles', { filters: [{ col: 'ics_token', op: 'eq', value: token }], columns: ['user_id'], limit: 1 });
    if (!rows[0]) return new Response('Not found', { status: 404 });
    const c = await serviceSession(String(rows[0].user_id));
    const ics = await runWithCtx(c, async () => {
      const [jobs, programs, exams, tasks] = await Promise.all([jobsTable().all(), programsTable().all(), examsTable().all(), tasksTable().all()]);
      return icsCalendar(buildEvents({ jobs: jobs.map(toSummary), programs, exams, tasks }));
    });
    return new Response(ics, {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'Content-Disposition': 'inline; filename="interniq.ics"' },
    });
  }

  return async function handle(req: Request): Promise<Response> {
    await ready;
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';
    const cors = corsHeaders(req);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
      if (req.method === 'GET' && path === '/health') {
        const problems = envProblems(env);
        return json({ ok: !problems.length, version: APP_VERSION, problems }, problems.length ? 500 : 200, cors);
      }
      if (req.method === 'POST' && (path === '/' || path === '/rpc')) return await handleRpc(req, cors);
      if (req.method === 'GET' && path === '/gmail/callback') return await handleGmailCallback(url);
      if (req.method === 'POST' && path === '/cron') return await handleCron(req);
      const ics = /^\/ics\/([A-Za-z0-9_-]{20,64})(?:\.ics)?$/.exec(path);
      if (req.method === 'GET' && ics) return await handleIcs(ics[1]!);
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404, cors);
    } catch (e) {
      log.error('http.unhandled', { path, message: errorMessage(e), stack: e instanceof Error ? (e.stack ?? '').slice(0, 1500) : '' });
      return fail('INTERNAL', 'Something went wrong on our side. Please try again.', 500, cors);
    }
  };
}
