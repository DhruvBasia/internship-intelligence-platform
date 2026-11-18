/**
 * Outbound HTTP for job sources, posting pages and AI providers.
 *
 * The server fetches URLs that users type in, so every request (and every
 * redirect hop) is checked against private and internal addresses to prevent
 * server-side request forgery, and responses are size- and time-capped.
 */
export interface HttpRequest {
  url: string;
  method?: 'get' | 'post';
  headers?: Record<string, string>;
  /** JSON body; sent with content-type application/json. */
  body?: string;
  /** Abort after this many ms (default 20 s). */
  timeoutMs?: number;
  /** Refuse bodies larger than this (default 8 MB). */
  maxBytes?: number;
}

export interface HttpResponse {
  status: number;
  text: string;
  /** Network-level failure (DNS, TLS, timeout, blocked). Empty when an HTTP status was received. */
  error: string;
  headers: Record<string, string>;
}

const USER_AGENT = 'InternIQ/3 (+https://github.com/DhruvBasia/internship-intelligence-platform)';

function ipv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Why a URL may not be fetched, or '' when it is fine. */
export function blockedReason(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'only http(s) links can be fetched';
  if (u.username || u.password) return 'links with credentials are not allowed';
  if (u.port && u.port !== '80' && u.port !== '443') return 'non-standard ports are not allowed';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !host.includes(':')) return 'internal host names are not allowed';
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return 'internal host names are not allowed';
  if (ipv4Private(host)) return 'private network addresses are not allowed';
  if (host.includes(':')) {
    // IPv6 literal: allow only global unicast (2000::/3).
    if (!/^[23][0-9a-f]{0,3}:/.test(host)) return 'private network addresses are not allowed';
    if (/^::ffff:/.test(host)) return 'private network addresses are not allowed';
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return 'numeric host names are not allowed';
  if (/(^|\.)metadata(\.google\.internal)?$/.test(host)) return 'internal host names are not allowed';
  return '';
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`response too large (${Math.round(declared / 1e6)} MB)`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response too large (over ${Math.round(maxBytes / 1e6)} MB)`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(all);
}

export async function httpFetchWith(fetchImpl: typeof fetch, req: HttpRequest): Promise<HttpResponse> {
  const timeoutMs = req.timeoutMs ?? 20_000;
  const maxBytes = req.maxBytes ?? 8_000_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = req.url;
    for (let hop = 0; hop < 6; hop++) {
      const blocked = blockedReason(url);
      if (blocked) return { status: 0, text: '', error: `Blocked: ${blocked}`, headers: {} };
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...(req.headers ?? {}) };
      if (req.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetchImpl(url, {
        method: (req.method ?? 'get').toUpperCase(),
        headers,
        body: hop === 0 ? req.body : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url).toString();
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => (out[k.toLowerCase()] = v));
      return { status: res.status, text: await readCapped(res, maxBytes), error: '', headers: out };
    }
    return { status: 0, text: '', error: 'Too many redirects', headers: {} };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)} s` : e.message) : String(e);
    return { status: 0, text: '', error: msg.slice(0, 300), headers: {} };
  } finally {
    clearTimeout(timer);
  }
}

/** Run tasks with at most `limit` in flight; results keep input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
