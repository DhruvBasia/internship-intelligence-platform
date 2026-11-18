/**
 * The real migration on real Postgres (PGlite): row-level security, the request
 * context function, locks, rate limits and least-privilege grants.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { filterParams, PostgrestDb } from '../src/server/platform/db';
import { createAuthUser, createDatabase, dbs } from '../tools/pg';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
let pg: PGlite;

beforeAll(async () => {
  pg = await createDatabase();
  await createAuthUser(pg, A, 'a@example.com');
  await createAuthUser(pg, B, 'b@example.com');
}, 60_000);

const job = (user: string, id: string, extra: Record<string, unknown> = {}) => ({ user_id: user, id, company: 'Acme', role: 'ML Intern', tags: ['x'], ...extra });

describe('schema and row-level security', () => {
  it('creates the profile on first context load and returns small state', async () => {
    const ctx = await dbs(pg, A).user.rpc<any>('interniq_context', {});
    expect(ctx.profile.user_id).toBe(A);
    expect(ctx.profile.email).toBe('a@example.com');
    expect(ctx.kv).toEqual({});
    expect(ctx.gmail).toBeNull();
  });

  it('keeps each user inside their own rows', async () => {
    const a = dbs(pg, A).user;
    const b = dbs(pg, B).user;
    await a.insert('jobs', [job(A, 'j_aaaaaa111111')]);
    await b.insert('jobs', [job(B, 'j_bbbbbb222222')]);
    expect((await a.select('jobs', { filters: [] })).map((r) => r.id)).toEqual(['j_aaaaaa111111']);
    expect((await b.select('jobs', { filters: [] })).map((r) => r.id)).toEqual(['j_bbbbbb222222']);
    // Writing a row for someone else is refused by the policy's WITH CHECK.
    await expect(b.insert('jobs', [job(A, 'j_evil00000000')])).rejects.toThrow();
    // Deleting someone else's rows silently matches nothing.
    expect(await b.delete('jobs', [{ col: 'user_id', op: 'eq', value: A }], ['id'])).toEqual([]);
    expect(await a.select('jobs', { filters: [] })).toHaveLength(1);
  });

  it('never exposes secrets, Gmail tokens or the shared cache to users', async () => {
    const { user, service } = dbs(pg, A);
    await service.upsert('user_secrets', [{ user_id: A, name: 'ai.gemini', ciphertext: 'v1.x.y' }], ['user_id', 'name']);
    await service.upsert('gmail_connections', [{ user_id: A, email: 'a@example.com', refresh_token_enc: 'v1.a.b' }], ['user_id']);
    await expect(user.select('user_secrets', { filters: [] })).rejects.toThrow(/permission/);
    await expect(user.select('gmail_connections', { filters: [] })).rejects.toThrow(/permission/);
    await expect(user.insert('source_cache', [{ key: 'simplify', body: [] }])).rejects.toThrow(/permission/);
    const ctx = await user.rpc<any>('interniq_context', {});
    expect(ctx.secrets).toEqual({ 'ai.gemini': 'v1.x.y' });
    expect(ctx.gmail).toMatchObject({ email: 'a@example.com', status: 'active' });
    expect(JSON.stringify(ctx)).not.toContain('v1.a.b');
  });

  it('lets users edit their profile but not their email or blocked flag', async () => {
    const { user } = dbs(pg, A);
    await user.update('profiles', { name: 'Asha', settings: { onboarded: true } }, [{ col: 'user_id', op: 'eq', value: A }]);
    const [row] = await user.select('profiles', { filters: [] });
    expect(row).toMatchObject({ name: 'Asha', settings: { onboarded: true } });
    await expect(user.update('profiles', { blocked: false }, [{ col: 'user_id', op: 'eq', value: A }])).rejects.toThrow(/permission/);
    await expect(user.update('profiles', { email: 'x@y.z' }, [{ col: 'user_id', op: 'eq', value: A }])).rejects.toThrow(/permission/);
  });

  it('only the service role can act for another user or read admin numbers', async () => {
    const { user, service } = dbs(pg, A);
    await expect(user.rpc('interniq_context', { p_user: B })).rejects.toThrow(/forbidden/);
    await expect(user.rpc('interniq_admin_overview', {})).rejects.toThrow();
    const other = await service.rpc<any>('interniq_context', { p_user: B });
    expect(other.profile.email).toBe('b@example.com');
    const overview = await service.rpc<any>('interniq_admin_overview', {});
    expect(overview.users).toBe(2);
    expect(overview.recent.map((r: any) => r.email).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('hands out one lease lock per user at a time', async () => {
    const { user } = dbs(pg, A);
    expect(await user.rpc('interniq_lock', { p_user: A, p_holder: 'one', p_ttl_seconds: 60 })).toBe(true);
    expect(await user.rpc('interniq_lock', { p_user: A, p_holder: 'two', p_ttl_seconds: 60 })).toBe(false);
    expect(await user.rpc('interniq_lock', { p_user: A, p_holder: 'one', p_ttl_seconds: 60 })).toBe(true);
    await user.rpc('interniq_unlock', { p_user: A, p_holder: 'one' });
    expect(await user.rpc('interniq_lock', { p_user: A, p_holder: 'two', p_ttl_seconds: 60 })).toBe(true);
    await user.rpc('interniq_unlock', { p_user: A, p_holder: 'two' });
  });

  it('counts rate-limit hits per window', async () => {
    const { user } = dbs(pg, B);
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await user.rpc('interniq_rate', { p_user: B, p_bucket: 'refresh', p_limit: 3, p_window_seconds: 600 }));
    expect(hits).toEqual([true, true, true, false]);
  });

  it('cascades job text deletes and prunes stale discovered postings', async () => {
    const { user } = dbs(pg, B);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await user.insert('jobs', [job(B, 'j_old000000001', { created_at: old }), job(B, 'j_saved0000001', { created_at: old, stage: 'saved' })]);
    await user.insert('job_texts', [{ user_id: B, id: 'j_old000000001', description: 'text' }]);
    const pruned = await user.rpc<number>('interniq_prune', { p_user: B, p_days: 30, p_keep: 500 });
    expect(pruned).toBe(1);
    expect(await user.select('job_texts', { filters: [{ col: 'id', op: 'eq', value: 'j_old000000001' }] })).toEqual([]);
    expect((await user.select('jobs', { filters: [], order: [{ col: 'id' }] })).map((r) => r.id)).toEqual(['j_bbbbbb222222', 'j_saved0000001']);
  });
});

describe('PostgREST adapter', () => {
  it('builds filters the way PostgREST expects', () => {
    const p = filterParams([
      { col: 'user_id', op: 'eq', value: A },
      { col: 'id', op: 'in', value: ['j_1', 'a,b', 'q"x'] },
    ]);
    expect(p.get('user_id')).toBe(`eq.${A}`);
    expect(p.get('id')).toBe('in.(j_1,"a,b","q\\"x")');
  });

  it('sends the user token for user requests and pages large selects', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      const offset = Number(new URL(url).searchParams.get('offset'));
      const rows = offset === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [{ id: 1000 }];
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as unknown as typeof fetch;
    const db = new PostgrestDb({ url: 'https://x.supabase.co', apiKey: 'sb_publishable_abc', userToken: 'user.jwt.token', fetch: fakeFetch });
    const rows = await db.select('jobs', { filters: [{ col: 'user_id', op: 'eq', value: A }], order: [{ col: 'id' }] });
    expect(rows).toHaveLength(1001);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers).toMatchObject({ apikey: 'sb_publishable_abc', Authorization: 'Bearer user.jwt.token' });
    const service = new PostgrestDb({ url: 'https://x.supabase.co', apiKey: 'sb_secret_xyz', fetch: fakeFetch });
    await service.select('jobs', { filters: [], limit: 1 });
    expect(calls[2]!.headers.Authorization).toBeUndefined();
    expect(calls[2]!.headers.apikey).toBe('sb_secret_xyz');
  });
});
