import type { RpcResult } from '../shared/types';
import { AppError, errorMessage, toRpcError } from './errors';
import { cache } from './gas';
import { log } from './log';
import { flushActivity, resetRequestState } from './store/db';

function rateLimit(name: string, perMinute: number): void {
  const key = `rl:${name}:${Math.floor(Date.now() / 60_000)}`;
  const used = Number(cache.get(key) || 0);
  if (used >= perMinute) throw new AppError('RATE_LIMITED', 'That was a lot of requests in a short time. Try again in a minute.');
  cache.put(key, String(used + 1), 120);
}

/**
 * Wrap a handler as an RPC endpoint: fresh request state, optional per-user
 * rate limit, buffered activity flush, structured logs, and an error envelope
 * (google.script.run turns thrown errors into opaque strings).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rpc<A extends any[], R>(name: string, fn: (...args: A) => R, opts: { perMinute?: number } = {}) {
  return (...args: A): RpcResult<R> => {
    resetRequestState();
    const t0 = Date.now();
    const ref = `${name}-${t0.toString(36)}`;
    try {
      if (opts.perMinute) rateLimit(name, opts.perMinute);
      const data = fn(...args);
      flushActivity();
      log.info('rpc.ok', { name, ms: Date.now() - t0 });
      return { ok: true, data };
    } catch (e) {
      flushActivity();
      const error = toRpcError(e, ref);
      if (error.code === 'INTERNAL') {
        log.error('rpc.fail', { name, ref, message: errorMessage(e), stack: e instanceof Error ? (e.stack ?? '').slice(0, 1500) : '' });
      } else {
        log.warn('rpc.app_error', { name, code: error.code, message: error.message });
      }
      return { ok: false, error };
    }
  };
}

/** Wrap a trigger handler: same hygiene, but errors are logged (and re-thrown so Apps Script records a failure). */
export function job(name: string, fn: () => void): () => void {
  return () => {
    resetRequestState();
    const t0 = Date.now();
    try {
      fn();
      log.info('job.ok', { name, ms: Date.now() - t0 });
    } catch (e) {
      log.error('job.fail', { name, message: errorMessage(e) });
      throw e;
    } finally {
      flushActivity();
    }
  };
}
