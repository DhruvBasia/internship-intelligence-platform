/**
 * Opening and closing a request: one database round trip loads everything small
 * (profile, settings, state, encrypted secrets, Gmail status); changes are
 * written back when the request ends.
 */
import { log } from '../log';
import type { GmailStatus, ProfileRow, RequestCtx } from '../platform/context';
import { decryptText } from '../platform/crypto';
import type { Db } from '../platform/db';
import type { Env } from '../platform/env';
import { flushActivity } from './db';

interface ContextPayload {
  profile: ProfileRow;
  kv: Record<string, unknown>;
  secrets: Record<string, string>;
  gmail: GmailStatus | null;
}

export interface SessionInput {
  userId: string;
  /** From the verified token; the stored profile email is used in service mode. */
  email?: string;
  db: Db;
  service: Db;
  env: Env;
  fetch: typeof fetch;
}

let holderSeq = 0;

export async function openSession(input: SessionInput): Promise<RequestCtx> {
  const args = input.db.role === 'service' ? { p_user: input.userId } : {};
  const data = await input.db.rpc<ContextPayload>('interniq_context', args);
  const secrets = new Map<string, string>();
  for (const [name, cipher] of Object.entries(data.secrets ?? {})) {
    try {
      secrets.set(name, await decryptText(input.env.secretsKey, cipher));
    } catch {
      // Key rotated or data damaged: treat as missing so the user can set it again.
      log.warn('secret.decrypt_failed', { name });
    }
  }
  const email = (input.email || data.profile.email || '').toLowerCase();
  return {
    userId: input.userId,
    email,
    db: input.db,
    service: input.service,
    env: input.env,
    fetch: input.fetch,
    isAdmin: Boolean(email) && input.env.adminEmails.includes(email),
    isOwner: Boolean(email) && email === input.env.ownerEmail,
    profile: data.profile,
    profileDirty: false,
    kv: new Map(Object.entries(data.kv ?? {})),
    kvDirty: new Set(),
    kvDeleted: new Set(),
    secrets,
    gmail: data.gmail ?? null,
    tables: new Map(),
    activity: [],
    lockDepth: 0,
    lockHolder: `${Date.now().toString(36)}-${(++holderSeq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

const PROFILE_COLUMNS = [
  'name',
  'school',
  'degree',
  'grad_year',
  'skills',
  'target_roles',
  'locations',
  'work_modes',
  'needs_sponsorship',
  'resume_text',
  'links',
  'settings',
] as const;

/** Write back profile, small state and activity. Safe to call more than once. */
export async function closeSession(c: RequestCtx): Promise<void> {
  const scope = [{ col: 'user_id', op: 'eq' as const, value: c.userId }];
  if (c.profileDirty) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of PROFILE_COLUMNS) patch[k] = c.profile[k];
    await c.db.update('profiles', patch, scope);
    c.profileDirty = false;
  }
  if (c.kvDirty.size) {
    const now = new Date().toISOString();
    const rows = Array.from(c.kvDirty).map((key) => ({ user_id: c.userId, key, value: c.kv.get(key) ?? null, updated_at: now }));
    await c.db.upsert('user_kv', rows, ['user_id', 'key']);
    c.kvDirty.clear();
  }
  if (c.kvDeleted.size) {
    await c.db.delete('user_kv', [...scope, { col: 'key', op: 'in', value: Array.from(c.kvDeleted) }]);
    c.kvDeleted.clear();
  }
  await flushActivity();
}
