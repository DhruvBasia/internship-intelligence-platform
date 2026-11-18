/**
 * The hourly worker, run per user by the cron endpoint, does everything in the
 * background idempotently: an email scan every hour (if Gmail is connected), a
 * daily job refresh at the user's chosen local hour, draining the AI queue in
 * later hours, and daily housekeeping. Each run stays well under the edge
 * function time limit.
 */
import { errorMessage } from './errors';
import { log } from './log';
import { mailStatus, scanMail } from './mail/sync';
import { ctx } from './platform/context';
import { deadlineIn, processAiQueue, refresh } from './pipeline';
import { localDayHour, props } from './runtime';
import { jobsTable } from './store/jobs';
import { getLastRefresh, getSettings } from './store/userState';

const PRUNE_DAYS = 30;
const PRUNE_KEEP = 600;

export async function runWorker(budgetMs = 120_000): Promise<string[]> {
  const did: string[] = [];
  const settings = getSettings();
  const deadline = deadlineIn(budgetMs);
  const tz = settings.automation.timezone;
  const { day, hour } = localDayHour(tz);

  if (settings.mail.enabled && mailStatus().ok) {
    try {
      await scanMail({ deadline: deadlineIn(Math.min(50_000, budgetMs / 2)) });
      did.push('mail');
    } catch (e) {
      log.warn('worker.mail_failed', { message: errorMessage(e) });
    }
  }

  // Housekeeping once a day: drop old, untouched discovered postings.
  if (props.get('prunedOn') !== day) {
    try {
      const c = ctx();
      const n = await c.db.rpc<number>('interniq_prune', { p_user: c.userId, p_days: PRUNE_DAYS, p_keep: PRUNE_KEEP });
      if (n) log.info('worker.pruned', { n });
      props.set('prunedOn', day);
      did.push('prune');
    } catch (e) {
      log.warn('worker.prune_failed', { message: errorMessage(e) });
    }
  }

  if (!settings.automation.enabled) return did;
  const last = getLastRefresh();
  const lastDay = last ? localDayHour(tz, new Date(last.finishedAt)).day : '';
  if (lastDay !== day && hour >= settings.automation.hour) {
    await refresh({ deadline, aiBudgetMs: Math.max(0, deadline.at - Date.now() - 40_000) });
    did.push('refresh');
    return did;
  }
  if ((await jobsTable().all()).some((j) => j.aiStatus === 'queued')) {
    await processAiQueue({ deadline });
    did.push('ai');
  }
  return did;
}
