/**
 * Supabase Edge Function entry (bundled by scripts/build.mjs into
 * supabase/functions/api/index.ts).
 */
import { verifyAccessToken } from '../platform/auth';
import { PostgrestDb } from '../platform/db';
import { envProblems, readEnv } from '../platform/env';
import { log } from '../log';
import { createHandler } from './handler';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = readEnv((k) => Deno.env.get(k));
const problems = envProblems(env);
if (problems.length) log.error('env.problems', { problems });

const f: typeof fetch = (input, init) => fetch(input, init);

Deno.serve(
  createHandler({
    env,
    fetch: f,
    userDb: (token) => new PostgrestDb({ url: env.supabaseUrl, apiKey: env.anonKey, userToken: token, fetch: f }),
    serviceDb: () => new PostgrestDb({ url: env.supabaseUrl, apiKey: env.serviceKey, fetch: f }),
    verify: (token) => verifyAccessToken(env, f, token),
    waitUntil: typeof EdgeRuntime !== 'undefined' ? (p) => EdgeRuntime.waitUntil(p) : undefined,
  }),
);
