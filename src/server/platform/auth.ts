/**
 * Verifies a Supabase access token by asking the project's auth server, which
 * works for every signing-key setup (legacy shared secret or asymmetric keys)
 * and also rejects tokens of deleted or banned users. Results are cached for a
 * minute per isolate to keep request latency low.
 */
import type { Env } from './env';

export interface AuthUser {
  id: string;
  email: string;
}

const cache = new Map<string, { user: AuthUser; until: number }>();

export async function verifyAccessToken(env: Env, fetchImpl: typeof fetch, token: string): Promise<AuthUser | null> {
  if (!token || token.length > 4096) return null;
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Auth server returned ${res.status}`);
  const body = (await res.json()) as { id?: string; email?: string };
  if (!body.id) return null;
  const user = { id: body.id, email: (body.email ?? '').toLowerCase() };
  if (cache.size > 5000) cache.clear();
  cache.set(token, { user, until: Date.now() + 60_000 });
  return user;
}
