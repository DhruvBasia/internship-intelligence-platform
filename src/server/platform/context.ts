/**
 * Per-request state. An edge isolate serves many users concurrently, so nothing
 * user-specific may live in module globals: it lives here, scoped to the request
 * with AsyncLocalStorage, and every server module reaches it through ctx().
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActivityEntry } from '../../shared/types';
import type { Db } from './db';
import type { Env } from './env';

/** Database row of public.profiles. */
export interface ProfileRow {
  user_id: string;
  email: string;
  name: string;
  school: string;
  degree: string;
  grad_year: number | null;
  skills: string[];
  target_roles: string[];
  locations: string[];
  work_modes: string[];
  needs_sponsorship: boolean;
  resume_text: string;
  links: Record<string, string>;
  settings: Record<string, unknown>;
  blocked: boolean;
  ics_token: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface GmailStatus {
  email: string;
  status: 'active' | 'revoked' | 'error';
  lastError: string;
  connectedAt: string;
}

export interface RequestCtx {
  userId: string;
  email: string;
  /** Requests on the user's behalf: user token (RLS) for API calls, service role in the worker. */
  db: Db;
  /** Service role: secrets, Gmail tokens, the shared source cache, admin. */
  service: Db;
  env: Env;
  fetch: typeof fetch;
  isAdmin: boolean;
  isOwner: boolean;
  profile: ProfileRow;
  profileDirty: boolean;
  kv: Map<string, unknown>;
  kvDirty: Set<string>;
  kvDeleted: Set<string>;
  /** Decrypted secrets by name (e.g. "ai.gemini"). */
  secrets: Map<string, string>;
  gmail: GmailStatus | null;
  /** Table instances with their per-request row caches (see store/table.ts). */
  tables: Map<string, unknown>;
  activity: ActivityEntry[];
  lockDepth: number;
  lockHolder: string;
}

const storage = new AsyncLocalStorage<RequestCtx>();

export function ctx(): RequestCtx {
  const c = storage.getStore();
  if (!c) throw new Error('No request context (server code called outside a request)');
  return c;
}

export function hasCtx(): boolean {
  return storage.getStore() !== undefined;
}

export function runWithCtx<T>(c: RequestCtx, fn: () => Promise<T>): Promise<T> {
  return storage.run(c, fn);
}

/**
 * Startup self-check: two interleaved contexts must not see each other. If a
 * runtime ever broke AsyncLocalStorage, requests are serialised instead of
 * risking one user's request reading another's state.
 */
let serial: Promise<unknown> | null = null;

export async function verifyIsolation(): Promise<boolean> {
  const seen: string[] = [];
  const probe = (id: string, delay: number) =>
    storage.run({ userId: id } as RequestCtx, async () => {
      await new Promise((r) => setTimeout(r, delay));
      seen.push(`${id}:${storage.getStore()?.userId}`);
    });
  await Promise.all([probe('a', 5), probe('b', 1)]);
  const ok = seen.sort().join() === 'a:a,b:b';
  if (!ok) serial = Promise.resolve();
  return ok;
}

/** Run a request, one at a time only if isolation could not be verified. */
export function isolated<T>(fn: () => Promise<T>): Promise<T> {
  if (!serial) return fn();
  const next = serial.then(fn, fn);
  serial = next.catch(() => undefined);
  return next;
}
