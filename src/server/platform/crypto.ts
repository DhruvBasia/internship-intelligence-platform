/**
 * Encryption at rest for user secrets (AI keys, Gmail refresh tokens) and HMAC
 * signatures for OAuth state. WebCrypto only, so it runs unchanged in Deno
 * (Supabase Edge Functions) and Node (tests, dev server).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array {
  return fromB64(s);
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** 32 raw bytes from the configured secret (base64 of 32 bytes, or any long passphrase hashed). */
async function keyBytes(secret: string): Promise<Uint8Array> {
  try {
    const raw = fromB64(secret.trim());
    if (raw.length === 32) return raw;
  } catch {
    /* not base64: hash it */
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(secret)));
}

function aesKey(secret: string): Promise<CryptoKey> {
  const k = 'aes:' + secret;
  let p = keyCache.get(k);
  if (!p) {
    p = keyBytes(secret).then((b) => crypto.subtle.importKey('raw', b as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']));
    keyCache.set(k, p);
  }
  return p;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  const k = 'hmac:' + secret;
  let p = keyCache.get(k);
  if (!p) {
    p = keyBytes(secret).then((b) => crypto.subtle.importKey('raw', b as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
    keyCache.set(k, p);
  }
  return p;
}

/** AES-256-GCM with a random IV. Output: "v1.<iv>.<ciphertext>" (base64url). */
export async function encryptText(secret: string, plain: string): Promise<string> {
  if (!secret) throw new Error('Encryption key is not configured');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(secret), enc.encode(plain) as BufferSource);
  return `v1.${toB64Url(iv)}.${toB64Url(new Uint8Array(ct))}`;
}

export async function decryptText(secret: string, payload: string): Promise<string> {
  const [v, iv, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unknown ciphertext format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64Url(iv) as BufferSource }, await aesKey(secret), fromB64Url(ct) as BufferSource);
  return dec.decode(plain);
}

export async function hmac(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data) as BufferSource);
  return toB64Url(new Uint8Array(sig));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signed, expiring token carrying a small JSON payload (OAuth state). */
export async function signToken(secret: string, payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const body = toB64Url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken<T extends Record<string, unknown>>(secret: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(await hmac(secret, body), sig)) return null;
  try {
    const data = JSON.parse(dec.decode(fromB64Url(body))) as T & { exp?: number };
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
