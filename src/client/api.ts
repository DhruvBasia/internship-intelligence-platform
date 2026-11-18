import type { Api, ApiMethod, ErrorCode, RpcError, RpcResult } from '../shared/types';
import { accessToken, sessionExpired } from './auth';
import { CONFIG } from './config';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly ref: string | undefined;
  constructor(e: RpcError) {
    super(e.message);
    this.code = e.code;
    this.ref = e.ref;
  }
}

type Result<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>;

/** Typed RPC to the InternIQ server, with the signed-in user's token. */
export async function call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<Result<M>> {
  const token = await accessToken();
  if (!token) {
    sessionExpired();
    throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Please sign in again.' });
  }
  let res: Response;
  try {
    res = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(CONFIG.anonKey ? { apikey: CONFIG.anonKey } : {}) },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    throw new ApiError({ code: 'INTERNAL', message: 'Network problem. Check your connection and try again.' });
  }
  let body: RpcResult<Result<M>>;
  try {
    body = (await res.json()) as RpcResult<Result<M>>;
  } catch {
    throw new ApiError({
      code: res.status === 504 || res.status === 546 ? 'BUSY' : 'INTERNAL',
      message: res.status === 504 || res.status === 546 ? 'That took too long. Please try again.' : `The server sent an unexpected reply (HTTP ${res.status}).`,
    });
  }
  if (body.ok) return body.data;
  if (body.error.code === 'UNAUTHENTICATED') sessionExpired();
  throw new ApiError(body.error);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
