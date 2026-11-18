/**
 * Server configuration, read once per isolate from the function's environment.
 * Supabase injects SUPABASE_URL and the API keys; everything else is set with
 * `supabase secrets set` (see scripts/setup.mjs).
 */
export interface Env {
  supabaseUrl: string;
  /** Publishable (anon) key: identifies the project, grants nothing by itself. */
  anonKey: string;
  /** Secret (service role) key: bypasses RLS. Used only for secrets, cron and admin. */
  serviceKey: string;
  /** Where the web app lives, e.g. https://you.github.io/interniq/ */
  appUrl: string;
  /** Origins allowed to call the API from a browser. */
  allowedOrigins: string[];
  /** Public URL of this function (Gmail OAuth redirect and cron fan-out). */
  functionUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Key for encrypting AI keys and Gmail tokens at rest, and signing OAuth state. */
  secretsKey: string;
  cronSecret: string;
  adminEmails: string[];
  /** The deployer: their private seed (profile, roadmap) is applied to this account only. */
  ownerEmail: string;
}

function firstKey(json: string | undefined): string {
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as Record<string, string> | string[];
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed);
    return values.find((v) => typeof v === 'string' && v) ?? '';
  } catch {
    return '';
  }
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function readEnv(get: (key: string) => string | undefined): Env {
  const supabaseUrl = (get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const appUrl = get('INTERNIQ_APP_URL') ?? '';
  const extraOrigins = (get('INTERNIQ_ALLOWED_ORIGINS') ?? '')
    .split(/[,\s]+/)
    .map((s) => originOf(s.trim()))
    .filter(Boolean);
  return {
    supabaseUrl,
    anonKey: get('SUPABASE_ANON_KEY') || firstKey(get('SUPABASE_PUBLISHABLE_KEYS')),
    serviceKey: get('SUPABASE_SERVICE_ROLE_KEY') || firstKey(get('SUPABASE_SECRET_KEYS')),
    appUrl,
    allowedOrigins: Array.from(new Set([originOf(appUrl), ...extraOrigins].filter(Boolean))),
    functionUrl: get('INTERNIQ_FUNCTION_URL') || (supabaseUrl ? `${supabaseUrl}/functions/v1/api` : ''),
    googleClientId: get('GOOGLE_CLIENT_ID') ?? '',
    googleClientSecret: get('GOOGLE_CLIENT_SECRET') ?? '',
    secretsKey: get('INTERNIQ_SECRETS_KEY') ?? '',
    cronSecret: get('INTERNIQ_CRON_SECRET') ?? '',
    adminEmails: list(get('INTERNIQ_ADMIN_EMAILS') || get('INTERNIQ_OWNER_EMAIL')),
    ownerEmail: (get('INTERNIQ_OWNER_EMAIL') ?? '').trim().toLowerCase(),
  };
}

/** Problems that make the deployment unusable; reported by /health and on startup. */
export function envProblems(env: Env): string[] {
  const out: string[] = [];
  if (!env.supabaseUrl) out.push('SUPABASE_URL is missing');
  if (!env.anonKey) out.push('the publishable (anon) key is missing');
  if (!env.serviceKey) out.push('the secret (service role) key is missing');
  if (!env.appUrl) out.push('INTERNIQ_APP_URL is not set');
  if (env.secretsKey.length < 32) out.push('INTERNIQ_SECRETS_KEY is missing or too short');
  return out;
}

export function gmailConfigured(env: Env): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret && env.secretsKey && env.functionUrl);
}
