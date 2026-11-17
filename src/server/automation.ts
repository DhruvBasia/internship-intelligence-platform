/**
 * One hourly trigger per user does everything in the background, idempotently:
 * a daily refresh at the user's chosen local hour, then draining the AI queue
 * in later hours, then the digest. Each run stays well under Apps Script's
 * 6-minute limit and exits in about a second when there is nothing to do.
 */
import type { Settings } from '../shared/types';
import { buildDigest } from './digest';
import { currentUserEmail, localDayHour, remainingMailQuota, sendMail, triggers, webAppUrl } from './gas';
import { log } from './log';
import { deadlineIn, processAiQueue, refresh } from './pipeline';
import { jobsTable, logActivity, toSummary } from './store/jobs';
import { getLastDigestAt, getLastRefresh, getProfile, getSettings, setLastDigestAt } from './store/userState';

export const WORKER = 'worker';

export function syncTriggers(settings: Settings): void {
  if (settings.automation.enabled) triggers.ensureHourly(WORKER);
  else triggers.removeAll(WORKER);
}

export function runWorker(): void {
  const settings = getSettings();
  if (!settings.automation.enabled) {
    triggers.removeAll(WORKER);
    return;
  }
  const tz = settings.automation.timezone;
  const { day, hour } = localDayHour(tz);
  const last = getLastRefresh();
  const lastDay = last ? localDayHour(tz, new Date(last.finishedAt)).day : '';
  const deadline = deadlineIn(300_000);

  if (lastDay !== day && hour >= settings.automation.hour) {
    refresh({ deadline, aiBudgetMs: 200_000 });
    maybeSendDigest(settings);
    return;
  }
  const queued = jobsTable().all().some((j) => j.aiStatus === 'queued');
  if (queued) processAiQueue({ deadline });
}

export function maybeSendDigest(settings: Settings): void {
  if (!settings.automation.digest) return;
  const since = getLastDigestAt() || new Date(Date.now() - 86_400_000).toISOString();
  const fresh = jobsTable()
    .all()
    .filter((j) => j.createdAt > since && j.score >= settings.automation.digestThreshold && (j.stage === 'discovered' || j.stage === 'saved'))
    .sort((a, b) => b.score - a.score)
    .map(toSummary);
  const now = new Date().toISOString();
  if (!fresh.length) {
    setLastDigestAt(now);
    return;
  }
  const to = currentUserEmail();
  if (!to || remainingMailQuota() < 1) {
    log.warn('digest.skipped', { reason: to ? 'mail quota' : 'no email' });
    return;
  }
  const digest = buildDigest(fresh, { name: getProfile().name, threshold: settings.automation.digestThreshold, appUrl: webAppUrl() });
  if (!digest) return;
  sendMail(to, digest.subject, digest.text, digest.html);
  setLastDigestAt(now);
  logActivity('', 'digest', `Digest emailed with ${fresh.length} match${fresh.length === 1 ? '' : 'es'}`);
}
