/**
 * Structured logs. In Apps Script these land in Cloud Logging (Executions view)
 * as JSON payloads, which makes them filterable by event name.
 */
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, data?: Record<string, unknown>): void {
  const entry = { level, event, ...(data ?? {}) };
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = `${level} ${event}`;
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
