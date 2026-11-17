/**
 * The only module that touches Apps Script globals directly (besides the store,
 * which needs Spreadsheet objects). Keeping platform calls here makes the rest
 * of the server testable against the fakes in tools/gas-fakes.mjs.
 *
 * Nothing in this file may run at import time: the build evaluates the bundle
 * outside Apps Script to discover exported functions.
 */
import { AppError, errorMessage } from './errors';

export interface HttpRequest {
  url: string;
  method?: 'get' | 'post';
  headers?: Record<string, string>;
  /** JSON body; sent with content-type application/json. */
  body?: string;
}

export interface HttpResponse {
  status: number;
  text: string;
  /** Network-level failure (DNS, TLS, timeout). Empty when an HTTP status was received. */
  error: string;
  headers: Record<string, string>;
}

const USER_AGENT = 'InternIQ/2 (+https://github.com/DhruvBasia/internship-intelligence-platform)';

function toParams(req: HttpRequest): GoogleAppsScript.URL_Fetch.URLFetchRequest {
  const params: GoogleAppsScript.URL_Fetch.URLFetchRequest = {
    url: req.url,
    method: req.method ?? 'get',
    headers: { 'User-Agent': USER_AGENT, ...(req.headers ?? {}) },
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true,
  };
  if (req.body !== undefined) {
    params.payload = req.body;
    params.contentType = 'application/json';
  }
  return params;
}

function toResponse(r: GoogleAppsScript.URL_Fetch.HTTPResponse): HttpResponse {
  let headers: Record<string, string> = {};
  try {
    headers = r.getHeaders() as Record<string, string>;
  } catch {
    /* headers are best-effort */
  }
  return { status: r.getResponseCode(), text: r.getContentText(), error: '', headers };
}

export function httpFetch(req: HttpRequest): HttpResponse {
  try {
    return toResponse(UrlFetchApp.fetch(req.url, toParams(req)));
  } catch (e) {
    return { status: 0, text: '', error: errorMessage(e).slice(0, 300), headers: {} };
  }
}

/** Parallel fetch. If the batch throws (one bad host fails the whole call), fall back to one-by-one. */
export function httpFetchAll(reqs: HttpRequest[]): HttpResponse[] {
  if (!reqs.length) return [];
  if (reqs.length === 1) return [httpFetch(reqs[0]!)];
  try {
    return UrlFetchApp.fetchAll(reqs.map(toParams)).map(toResponse);
  } catch {
    return reqs.map(httpFetch);
  }
}

// ---------------------------------------------------------------------------
// Per-user properties (settings, secrets, small state)

function userProps(): GoogleAppsScript.Properties.Properties {
  return PropertiesService.getUserProperties();
}

export const props = {
  get(key: string): string | null {
    return userProps().getProperty(key);
  },
  set(key: string, value: string): void {
    userProps().setProperty(key, value);
  },
  del(key: string): void {
    userProps().deleteProperty(key);
  },
  getJson<T>(key: string, fallback: T): T {
    const raw = userProps().getProperty(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    userProps().setProperty(key, JSON.stringify(value));
  },
  keys(): string[] {
    return userProps().getKeys();
  },
  deleteAll(): void {
    userProps().deleteAllProperties();
  },
};

/** Store a long string across several properties (each value is capped at ~9 KB). */
export function setChunked(prefix: string, value: string, chunkChars = 2800): void {
  const p = userProps();
  const oldCount = Number(p.getProperty(prefix + '.n') || 0);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkChars) chunks.push(value.slice(i, i + chunkChars));
  const batch: Record<string, string> = { [prefix + '.n']: String(chunks.length) };
  chunks.forEach((c, i) => (batch[prefix + '.' + i] = c));
  p.setProperties(batch);
  for (let i = chunks.length; i < oldCount; i++) p.deleteProperty(prefix + '.' + i);
}

export function getChunked(prefix: string): string {
  const p = userProps();
  const n = Number(p.getProperty(prefix + '.n') || 0);
  let out = '';
  for (let i = 0; i < n; i++) out += p.getProperty(prefix + '.' + i) ?? '';
  return out;
}

// ---------------------------------------------------------------------------
// Cache (rate limiting, short-lived memo)

export const cache = {
  get(key: string): string | null {
    try {
      return CacheService.getUserCache()?.get(key) ?? null;
    } catch {
      return null;
    }
  },
  put(key: string, value: string, ttlSeconds: number): void {
    try {
      CacheService.getUserCache()?.put(key, value, Math.max(1, Math.min(21600, Math.round(ttlSeconds))));
    } catch {
      /* cache is best-effort */
    }
  },
  remove(key: string): void {
    try {
      CacheService.getUserCache()?.remove(key);
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------------------
// Locking: one writer per user at a time (UI calls and the hourly worker).

let lockDepth = 0;

export function withUserLock<T>(fn: () => T, timeoutMs = 20_000): T {
  if (lockDepth > 0) return fn();
  const lock = LockService.getUserLock();
  if (!lock.tryLock(timeoutMs)) {
    throw new AppError('BUSY', 'Another update is still running (maybe a scheduled refresh). Try again in a moment.');
  }
  lockDepth++;
  try {
    return fn();
  } finally {
    lockDepth--;
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Identity, mail, triggers, misc

export function currentUserEmail(): string {
  try {
    return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '';
  } catch {
    return '';
  }
}

export function sendMail(to: string, subject: string, text: string, html: string): void {
  MailApp.sendEmail({ to, subject, body: text, htmlBody: html, name: 'InternIQ' });
}

export function remainingMailQuota(): number {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch {
    return 0;
  }
}

export function webAppUrl(): string {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch {
    return '';
  }
}

export const triggers = {
  list(handler: string): GoogleAppsScript.Script.Trigger[] {
    return ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === handler);
  },
  ensureHourly(handler: string): void {
    const existing = this.list(handler);
    existing.slice(1).forEach((t) => ScriptApp.deleteTrigger(t));
    if (!existing.length) ScriptApp.newTrigger(handler).timeBased().everyHours(1).create();
  },
  removeAll(handler: string): void {
    this.list(handler).forEach((t) => ScriptApp.deleteTrigger(t));
  },
};

export function uuid(): string {
  return Utilities.getUuid().replace(/-/g, '');
}

export function sleep(ms: number): void {
  Utilities.sleep(ms);
}

/** Calendar day (YYYY-MM-DD) and hour in the user's timezone. */
export function localDayHour(tz: string, at: Date = new Date()): { day: string; hour: number } {
  try {
    const s = Utilities.formatDate(at, tz, "yyyy-MM-dd'|'H");
    const [day, hour] = s.split('|');
    return { day: day!, hour: Number(hour) };
  } catch {
    return { day: at.toISOString().slice(0, 10), hour: at.getUTCHours() };
  }
}
