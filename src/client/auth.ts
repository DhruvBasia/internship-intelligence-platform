/**
 * Sign-in with Google through Supabase Auth (PKCE). Sign-in asks Google only
 * for the basic profile; Gmail access is a separate, optional step.
 */
import { signal } from '@preact/signals';
import { GoTrueClient } from '@supabase/auth-js';
import { CONFIG } from './config';

export interface SessionInfo {
  email: string;
  name: string;
  avatar: string;
}

/** undefined while starting up, null when signed out. */
export const session = signal<SessionInfo | null | undefined>(undefined);
export const authError = signal('');

let client: GoTrueClient | null = null;

/** Only Supabase's auth client: the app talks to its own API, not to the database directly. */
function supabase(): { auth: GoTrueClient } {
  client ??= new GoTrueClient({
    url: `${CONFIG.supabaseUrl}/auth/v1`,
    // Legacy anon keys are JWTs and also go in Authorization; new publishable keys go in apikey only.
    headers: CONFIG.anonKey.startsWith('eyJ') ? { apikey: CONFIG.anonKey, Authorization: `Bearer ${CONFIG.anonKey}` } : { apikey: CONFIG.anonKey },
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'interniq-auth',
  });
  return { auth: client };
}

function info(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): SessionInfo | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  return {
    email: user.email ?? '',
    name: String(meta.full_name ?? meta.name ?? ''),
    avatar: String(meta.avatar_url ?? meta.picture ?? ''),
  };
}

export async function initAuth(): Promise<void> {
  if (CONFIG.mode === 'dev') {
    // ?signedout previews the landing page locally.
    session.value = new URLSearchParams(location.search).has('signedout') ? null : { email: 'you@dev.local', name: 'Dev Student', avatar: '' };
    return;
  }
  const params = new URLSearchParams(location.search);
  if (params.get('error_description')) authError.value = params.get('error_description')!;
  const sb = supabase();
  // Exchanges ?code= from the Google redirect for a session, if present.
  const { data, error } = await sb.auth.getSession();
  if (error) authError.value = error.message;
  session.value = info(data.session?.user);
  if (params.has('code') || params.has('error')) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
  sb.auth.onAuthStateChange((_event, s) => {
    session.value = info(s?.user);
  });
}

export async function accessToken(): Promise<string> {
  if (CONFIG.mode === 'dev') return 'dev';
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? '';
}

export async function signInWithGoogle(): Promise<void> {
  authError.value = '';
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: CONFIG.appUrl || location.origin + location.pathname,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) authError.value = error.message;
}

export async function signOut(): Promise<void> {
  try {
    localStorage.removeItem('iip.view');
  } catch {
    /* ignore */
  }
  if (CONFIG.mode !== 'dev') await supabase().auth.signOut();
  location.hash = '';
  location.reload();
}

/** Called when the server says the session is no longer valid. */
export function sessionExpired(): void {
  if (CONFIG.mode === 'dev') return;
  void supabase()
    .auth.signOut({ scope: 'local' })
    .finally(() => (session.value = null));
}
