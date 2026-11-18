/**
 * The RPC surface: method name → handler, with per-user rate limits. The edge
 * handler validates the method name against this table before calling anything.
 */
import type { ApiMethod, RpcResult } from '../shared/types';
import * as api from './api';
import { AppError, errorMessage, toRpcError } from './errors';
import { log } from './log';
import { ctx } from './platform/context';
import { closeSession } from './store/session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => Promise<unknown>;

interface Entry {
  fn: Handler;
  /** Per-user calls per minute (database-backed, so it holds across isolates). */
  perMinute?: number;
}

export const RPC: Record<ApiMethod, Entry> = {
  bootstrap: { fn: api.bootstrap, perMinute: 30 },
  saveProfile: { fn: api.saveProfile, perMinute: 20 },
  saveSettings: { fn: api.saveSettings, perMinute: 40 },
  completeOnboarding: { fn: api.completeOnboarding },
  setSecret: { fn: api.setSecret, perMinute: 6 },
  clearSecret: { fn: api.clearSecret },
  listModels: { fn: api.listModels, perMinute: 10 },
  testAi: { fn: api.testAi, perMinute: 4 },
  getUsage: { fn: api.getUsage },
  listJobs: { fn: api.listJobs },
  getJob: { fn: api.getJob, perMinute: 60 },
  createJob: { fn: api.createJob, perMinute: 30 },
  updateJob: { fn: api.updateJob, perMinute: 120 },
  bulkUpdate: { fn: api.bulkUpdate, perMinute: 30 },
  deleteJobs: { fn: api.deleteJobs, perMinute: 30 },
  refreshNow: { fn: api.refreshNow, perMinute: 3 },
  addFromUrl: { fn: api.addFromUrl, perMinute: 15 },
  analyzeWithAi: { fn: api.analyzeWithAi, perMinute: 10 },
  rescoreAll: { fn: api.rescoreAll, perMinute: 4 },
  generateCoverLetter: { fn: api.generateCoverLetter, perMinute: 8 },
  saveCoverLetter: { fn: api.saveCoverLetter, perMinute: 60 },
  importTsv: { fn: api.importTsv, perMinute: 6 },
  importStarterPack: { fn: api.importStarterPack, perMinute: 3 },
  importFromSheet: { fn: api.importFromSheet, perMinute: 3 },
  resolveBoard: { fn: api.resolveBoard, perMinute: 15 },
  getActivity: { fn: api.getActivity },
  exportData: { fn: api.exportData, perMinute: 3 },
  deleteAccount: { fn: api.deleteAccount, perMinute: 2 },
  updateProgram: { fn: api.updateProgram, perMinute: 120 },
  createProgram: { fn: api.createProgram, perMinute: 30 },
  deleteProgram: { fn: api.deleteProgram, perMinute: 30 },
  updateExam: { fn: api.updateExam, perMinute: 120 },
  createExam: { fn: api.createExam, perMinute: 30 },
  deleteExam: { fn: api.deleteExam, perMinute: 30 },
  refreshCatalogs: { fn: api.refreshCatalogs, perMinute: 4 },
  createTask: { fn: api.createTask, perMinute: 60 },
  updateTask: { fn: api.updateTask, perMinute: 120 },
  deleteTask: { fn: api.deleteTask, perMinute: 60 },
  scanMail: { fn: api.scanMail, perMinute: 4 },
  mailAction: { fn: api.mailAction, perMinute: 120 },
  connectGmail: { fn: api.connectGmail, perMinute: 6 },
  disconnectGmail: { fn: api.disconnectGmail, perMinute: 6 },
  calendarFeed: { fn: api.calendarFeed, perMinute: 6 },
  adminOverview: { fn: api.adminOverview, perMinute: 20 },
  adminSetBlocked: { fn: api.adminSetBlocked, perMinute: 30 },
  adminInstallCron: { fn: api.adminInstallCron, perMinute: 4 },
};

export function isMethod(name: unknown): name is ApiMethod {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(RPC, name);
}

async function rateLimit(name: string, perMinute: number): Promise<void> {
  const c = ctx();
  const ok = await c.db.rpc<boolean>('interniq_rate', { p_user: c.userId, p_bucket: name, p_limit: perMinute, p_window_seconds: 60 });
  if (!ok) throw new AppError('RATE_LIMITED', 'That was a lot of requests in a short time. Try again in a minute.');
}

/** Run one RPC inside the current request context and wrap the result in an envelope. */
export async function invoke(name: ApiMethod, args: unknown[]): Promise<RpcResult<unknown>> {
  const entry = RPC[name];
  const t0 = Date.now();
  const ref = `${name}-${t0.toString(36)}`;
  try {
    if (entry.perMinute) await rateLimit(name, entry.perMinute);
    const data = await entry.fn(...args);
    await closeSession(ctx());
    log.info('rpc.ok', { name, ms: Date.now() - t0 });
    return { ok: true, data };
  } catch (e) {
    await closeSession(ctx()).catch((err) => log.warn('rpc.close_failed', { name, message: errorMessage(err) }));
    const error = toRpcError(e, ref);
    if (error.code === 'INTERNAL' || error.code === 'BUSY') {
      log.error('rpc.fail', { name, ref, message: errorMessage(e), stack: e instanceof Error ? (e.stack ?? '').slice(0, 1500) : '' });
    } else {
      log.warn('rpc.app_error', { name, code: error.code, message: error.message });
    }
    return { ok: false, error };
  }
}
