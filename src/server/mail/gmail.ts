/**
 * Gmail access with each user's own consent (read-only scope only).
 *
 * Connecting is a separate step from signing in: sign-in asks Google for the
 * basic profile only, and students who want inbox tracking grant
 * gmail.readonly here. The refresh token is encrypted before it is stored and
 * never leaves the server.
 */
import { AppError } from '../errors';
import { log } from '../log';
import { ctx } from '../platform/context';
import { decryptText, encryptText, randomToken, signToken, verifyToken } from '../platform/crypto';
import type { Db } from '../platform/db';
import { gmailConfigured, type Env } from '../platform/env';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const redirectUri = (env: Env) => `${env.functionUrl}/gmail/callback`;

/** The Google consent URL for this user (RPC). */
export async function gmailConnectUrl(): Promise<{ url: string }> {
  const c = ctx();
  if (!gmailConfigured(c.env)) throw new AppError('BAD_INPUT', 'Gmail tracking is not set up on this InternIQ server yet.');
  const state = await signToken(c.env.secretsKey, { uid: c.userId, n: randomToken(8) }, 15 * 60);
  const params = new URLSearchParams({
    client_id: c.env.googleClientId,
    redirect_uri: redirectUri(c.env),
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (c.email) params.set('login_hint', c.email);
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { status: res.status, body };
}

/** OAuth redirect target. Returns the user id on success, or a reason to show. */
export async function completeGmailConnect(
  env: Env,
  fetchImpl: typeof fetch,
  service: Db,
  params: URLSearchParams,
): Promise<{ ok: true; userId: string; email: string } | { ok: false; reason: string; userId?: string }> {
  if (params.get('error')) {
    return { ok: false, reason: params.get('error') === 'access_denied' ? 'You cancelled the Gmail permission.' : `Google said: ${params.get('error')}` };
  }
  const state = await verifyToken<{ uid: string }>(env.secretsKey, params.get('state') ?? '');
  if (!state?.uid) return { ok: false, reason: 'That link expired. Start "Connect Gmail" again.' };
  const code = params.get('code') ?? '';
  if (!code) return { ok: false, reason: 'Google did not send an authorisation code.', userId: state.uid };

  const token = await postForm(fetchImpl, TOKEN_URL, {
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: redirectUri(env),
    grant_type: 'authorization_code',
  });
  if (token.status !== 200) {
    log.warn('gmail.exchange_failed', { status: token.status, error: String(token.body.error ?? '') });
    return { ok: false, reason: 'Google refused the sign-in code. Try connecting again.', userId: state.uid };
  }
  const scope = String(token.body.scope ?? '');
  const refresh = String(token.body.refresh_token ?? '');
  const access = String(token.body.access_token ?? '');
  if (!scope.split(/\s+/).includes(GMAIL_SCOPE)) {
    return { ok: false, reason: 'Gmail read access was not granted. Tick the Gmail box on Google’s screen.', userId: state.uid };
  }
  if (!refresh) {
    return { ok: false, reason: 'Google did not grant offline access. Remove InternIQ in your Google Account → Security → Third-party access, then connect again.', userId: state.uid };
  }
  let email = '';
  try {
    const profile = await fetchImpl(`${API}/profile`, { headers: { Authorization: `Bearer ${access}` } });
    if (profile.ok) email = String(((await profile.json()) as { emailAddress?: string }).emailAddress ?? '');
  } catch {
    /* email is cosmetic */
  }
  const now = new Date().toISOString();
  await service.upsert(
    'gmail_connections',
    [{ user_id: state.uid, email, refresh_token_enc: await encryptText(env.secretsKey, refresh), scope, status: 'active', last_error: '', connected_at: now, updated_at: now }],
    ['user_id'],
  );
  return { ok: true, userId: state.uid, email };
}

const accessCache = new WeakMap<object, { token: string; until: number }>();

/** A short-lived access token for the current user's Gmail. */
export async function gmailAccessToken(): Promise<string> {
  const c = ctx();
  const hit = accessCache.get(c);
  if (hit && hit.until > Date.now()) return hit.token;
  const rows = await c.service.select('gmail_connections', { filters: [{ col: 'user_id', op: 'eq', value: c.userId }], limit: 1 });
  const row = rows[0];
  if (!row || row.status !== 'active') throw new AppError('BAD_INPUT', 'Connect Gmail first (Mail → Connect Gmail).');
  const refresh = await decryptText(c.env.secretsKey, String(row.refresh_token_enc));
  const res = await postForm(c.fetch, TOKEN_URL, {
    client_id: c.env.googleClientId,
    client_secret: c.env.googleClientSecret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  if (res.status !== 200) {
    const revoked = res.body.error === 'invalid_grant';
    await c.service.update(
      'gmail_connections',
      { status: revoked ? 'revoked' : 'error', last_error: String(res.body.error_description ?? res.body.error ?? `HTTP ${res.status}`).slice(0, 200), updated_at: new Date().toISOString() },
      [{ col: 'user_id', op: 'eq', value: c.userId }],
    );
    if (c.gmail) c.gmail = { ...c.gmail, status: revoked ? 'revoked' : 'error' };
    throw new AppError('FETCH_FAILED', revoked ? 'Gmail access was removed. Reconnect Gmail in the Mail tab.' : 'Google did not refresh Gmail access. Try again later.');
  }
  const token = String(res.body.access_token);
  accessCache.set(c, { token, until: Date.now() + (Number(res.body.expires_in) || 3000) * 900 });
  return token;
}

export async function gmailGet<T>(path: string): Promise<T> {
  const c = ctx();
  const token = await gmailAccessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await c.fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    throw new AppError('FETCH_FAILED', `Gmail returned ${res.status}.`);
  }
}

/** Revoke and forget this user's Gmail access (RPC). */
export async function gmailDisconnect(): Promise<void> {
  const c = ctx();
  const rows = await c.service.select('gmail_connections', { filters: [{ col: 'user_id', op: 'eq', value: c.userId }], limit: 1 });
  if (rows[0]) {
    try {
      const refresh = await decryptText(c.env.secretsKey, String(rows[0].refresh_token_enc));
      await postForm(c.fetch, 'https://oauth2.googleapis.com/revoke', { token: refresh });
    } catch {
      /* already revoked */
    }
    await c.service.delete('gmail_connections', [{ col: 'user_id', op: 'eq', value: c.userId }]);
  }
  c.gmail = null;
}
