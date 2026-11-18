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
  if (/JWT expired|invalid JWT|not signed in/i.test(msg)) {
    return { code: 'UNAUTHENTICATED', message: 'Your session expired. Please sign in again.', ref };
  }
  if (/Database unreachable|timeout|too many connections|503/i.test(msg)) {
    return { code: 'BUSY', message: 'The server is busy right now. Please try again in a moment.', ref };
  }
  return { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', ref };
}
