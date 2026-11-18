/**
 * Public, build-time configuration (see scripts/build.mjs and deploy/public.json).
 * Everything here is safe to ship to browsers: the publishable key only
 * identifies the project; row-level security protects the data.
 */
export interface ClientConfig {
  /** 'hosted' talks to Supabase; 'dev' talks to the local dev server with a fake sign-in. */
  mode: 'hosted' | 'dev';
  supabaseUrl: string;
  anonKey: string;
  /** RPC endpoint: <supabaseUrl>/functions/v1/api, or /api in dev. */
  apiUrl: string;
  /** Where this app is served (OAuth redirect target). */
  appUrl: string;
  /** Who runs this InternIQ (shown on the landing page). */
  operator: string;
}

declare const __IIP_CONFIG__: ClientConfig | undefined;

export const CONFIG: ClientConfig =
  typeof __IIP_CONFIG__ !== 'undefined' && __IIP_CONFIG__
    ? __IIP_CONFIG__
    : { mode: 'dev', supabaseUrl: '', anonKey: '', apiUrl: '/api', appUrl: '', operator: '' };

export const configured = CONFIG.mode === 'dev' || Boolean(CONFIG.supabaseUrl && CONFIG.anonKey && CONFIG.apiUrl);
