/**
 * Platform services for the rest of the server, all scoped to the current
 * request (see platform/context.ts). This replaces the Apps Script globals the
 * app used before: UrlFetchApp, PropertiesService, LockService and Utilities.
 */
import { AppError } from './errors';
import { ctx } from './platform/context';
import { httpFetchWith, pool, type HttpRequest, type HttpResponse } from './platform/http';

export type { HttpRequest, HttpResponse } from './platform/http';

export function httpFetch(req: HttpRequest): Promise<HttpResponse> {
  return httpFetchWith(ctx().fetch, req);
}

/** Parallel fetch (6 at a time); one failing request never sinks the others. */
export function httpFetchAll(reqs: HttpRequest[]): Promise<HttpResponse[]> {
  const f = ctx().fetch;
  return pool(reqs, 6, (r) => httpFetchWith(f, r));
}

// ---------------------------------------------------------------------------
// Small per-user state (public.user_kv), loaded with the request context and
// written back when the request finishes.

function stringValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export const props = {
  get(key: string): string | null {
    return stringValue(ctx().kv.get(key));
  },
  set(key: string, value: string): void {
    const c = ctx();
    c.kv.set(key, value);
    c.kvDirty.add(key);
    c.kvDeleted.delete(key);
  },
  del(key: string): void {
    const c = ctx();
    if (c.kv.delete(key)) c.kvDeleted.add(key);
    c.kvDirty.delete(key);
  },
  getJson<T>(key: string, fallback: T): T {
    const v = ctx().kv.get(key);
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T;
      } catch {
        return fallback;
      }
    }
    return v as T;
  },
  setJson(key: string, value: unknown): void {
    const c = ctx();
    c.kv.set(key, value);
    c.kvDirty.add(key);
    c.kvDeleted.delete(key);
  },
  keys(): string[] {
    return Array.from(ctx().kv.keys());
  },
};

// ---------------------------------------------------------------------------
// One writer per user at a time (UI calls and the hourly worker).

export async function withUserLock<T>(fn: () => Promise<T> | T, timeoutMs = 20_000): Promise<T> {
  const c = ctx();
  if (c.lockDepth > 0) return fn();
  const until = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const got = await c.db.rpc<boolean>('interniq_lock', { p_user: c.userId, p_holder: c.lockHolder, p_ttl_seconds: 150 });
    if (got) break;
    if (Date.now() > until) {
      throw new AppError('BUSY', 'Another update is still running (maybe a scheduled refresh). Try again in a moment.');
    }
    await sleep(Math.min(1000, 150 * (attempt + 1)));
  }
  c.lockDepth++;
  try {
    return await fn();
  } finally {
    c.lockDepth--;
    await c.db.rpc('interniq_unlock', { p_user: c.userId, p_holder: c.lockHolder }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Identity and small utilities

export function currentUserEmail(): string {
  return ctx().email;
}

export function appUrl(): string {
  return ctx().env.appUrl;
}

export function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Calendar day (YYYY-MM-DD) and hour in the user's timezone. */
export function localDayHour(tz: string, at: Date = new Date()): { day: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
  } catch {
    return { day: at.toISOString().slice(0, 10), hour: at.getUTCHours() };
  }
}
