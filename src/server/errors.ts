import type { ErrorCode, RpcError } from '../shared/types';

/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function badInput(message: string): AppError {
  return new AppError('BAD_INPUT', message);
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `${what} was not found. It may have been deleted.`);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Convert anything thrown into a client-safe error. Unknown errors never leak internals. */
export function toRpcError(e: unknown, ref: string): RpcError {
  if (e instanceof AppError) return { code: e.code, message: e.message };
  const msg = errorMessage(e);
  // Apps Script quota / service errors are worth surfacing in plain words.
  if (/Service invoked too many times|Exceeded maximum execution time|quota/i.test(msg)) {
    return { code: 'RATE_LIMITED', message: 'Google Apps Script quota reached for now. Please try again later.', ref };
  }
  if (/Lock timeout|could not obtain lock/i.test(msg)) {
    return { code: 'BUSY', message: 'Another update is still running. Try again in a few seconds.', ref };
  }
  return { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', ref };
}
