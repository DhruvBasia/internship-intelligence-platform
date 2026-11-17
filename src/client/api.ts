import type { Api, ApiMethod, ErrorCode, RpcError, RpcResult } from '../shared/types';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly ref: string | undefined;
  constructor(e: RpcError) {
    super(e.message);
    this.code = e.code;
    this.ref = e.ref;
  }
}

interface ScriptRunner {
  withSuccessHandler(fn: (r: unknown) => void): ScriptRunner;
  withFailureHandler(fn: (e: Error) => void): ScriptRunner;
  [method: string]: unknown;
}

declare global {
  interface Window {
    google?: { script?: { run?: ScriptRunner } };
    __IIP_BOOT__?: unknown;
  }
}

function friendlyTransportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/authoriz|permission/i.test(msg)) return 'Google needs you to re-authorise InternIQ. Reload the page to continue.';
  if (/network|connection|timed? ?out|HTTP 0/i.test(msg)) return 'Network hiccup talking to Google. Check your connection and try again.';
  if (/Exceeded maximum execution time/i.test(msg)) return 'That took too long for Google Apps Script. Try again with fewer items.';
  return 'Something went wrong talking to the server. Please try again.';
}

/** Typed promise wrapper around google.script.run with the server's RpcResult envelope. */
export function call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<ReturnType<Api[M]>> {
  return new Promise((resolve, reject) => {
    const run = window.google?.script?.run;
    if (!run) {
      reject(new ApiError({ code: 'INTERNAL', message: 'InternIQ must be opened from its Apps Script web app URL.' }));
      return;
    }
    const runner = run
      .withSuccessHandler((res: unknown) => {
        const r = res as RpcResult<ReturnType<Api[M]>> | null;
        if (r && r.ok) resolve(r.data);
        else reject(new ApiError(r && !r.ok ? r.error : { code: 'INTERNAL', message: 'Empty response from server.' }));
      })
      .withFailureHandler((err: Error) => reject(new ApiError({ code: 'INTERNAL', message: friendlyTransportError(err) })));
    const fn = runner[method] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn !== 'function') {
      reject(new ApiError({ code: 'INTERNAL', message: `Server method ${method} is missing. Redeploy the latest version.` }));
      return;
    }
    fn.apply(runner, args as unknown[]);
  });
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
