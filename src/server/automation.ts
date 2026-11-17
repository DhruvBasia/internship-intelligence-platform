/**
 * One hourly trigger per user does everything in the background, idempotently:
 * an email scan every hour (personal build), a daily job refresh at the user's
 * chosen local hour, draining the AI queue in later hours, and the daily digest.
 * Each run stays well under Apps Script's 6-minute limit.
 */
import type { Settings } from '../shared/types';
import { buildDigest, type UpcomingItem } from './digest';
import { errorMessage } from './errors';
import { currentUserEmail, localDayHour, remainingMailQuota, sendMail, triggers, webAppUrl } from './gas';
import { log } from './log';
import { mailStatus, scanMail } from './mail/sync';
import { deadlineIn, processAiQueue, refresh } from './pipeline';
import { jobsTable, logActivity, toSummary } from './store/jobs';
import { examsTable, programsTable, tasksTable } from './store/records';
import { getLastDigestAt, getLastRefresh, getProfile, getSettings, setLastDigestAt } from './store/userState';

export const WORKER = 'worker';

export function syncTriggers(settings: Settings): void {
  if (settings.automation.enabled || (settings.mail.enabled && mailStatus().ok)) triggers.ensureHourly(WORKER);
  else triggers.removeAll(WORKER);
}

export function runWorker(): void {
  const settings = getSettings();
  const mailOn = settings.mail.enabled && mailStatus().ok;
  if (!settings.automation.enabled && !mailOn) {
    triggers.removeAll(WORKER);
    return;
  }
  const deadline = deadlineIn(300_000);
  if (mailOn) {
    try {
      scanMail({ deadline: deadlineIn(90_000) });
    } catch (e) {
      log.warn('worker.mail_failed', { message: errorMessage(e) });
    }
  }
  if (!settings.automation.enabled) return;
  const tz = settings.automation.timezone;
  const { day, hour } = localDayHour(tz);
  const last = getLastRefresh();
  const lastDay = last ? localDayHour(tz, new Date(last.finishedAt)).day : '';
  if (lastDay !== day && hour >= settings.automation.hour) {
    refresh({ deadline, aiBudgetMs: 150_000 });
    maybeSendDigest(settings);
    return;
  }
  const queued = jobsTable().all().some((j) => j.aiStatus === 'queued');
  if (queued) processAiQueue({ deadline });
}

/** Everything dated in the next `days` days across internships, studies, exams and tasks. */
export function upcoming(days: number, now = new Date()): UpcomingItem[] {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const inRange = (d: string) => d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const out: UpcomingItem[] = [];
  for (const t of tasksTable().all()) if (t.status === 'todo' && inRange(t.due)) out.push({ when: t.due, title: t.title });
  for (const j of jobsTable().all()) {
    if (j.stage === 'archived' || j.stage === 'rejected') continue;
    if (inRange(j.deadline)) out.push({ when: j.deadline, title: `Apply: ${j.role} at ${j.company}` });
    if (inRange(j.followUpAt)) out.push({ when: j.followUpAt, title: `Follow up: ${j.role} at ${j.company}` });
  }
  for (const p of programsTable().all()) {
    if (['rejected', 'dropped', 'admitted', 'applied'].includes(p.stage) || p.fit === 'skip') continue;
    if (inRange(p.deadline)) out.push({ when: p.deadline, title: `Deadline: ${p.name}` });
  }
  for (const x of examsTable().all()) {
    if (x.stage === 'dropped') continue;
    for (const e of x.events) if (e.precision === 'day' && inRange(e.date)) out.push({ when: e.date, title: `${x.name}: ${e.label}` });
  }
  return out.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 15);
}

export function maybeSendDigest(settings: Settings): void {
  if (!settings.automation.digest) return;
  const since = getLastDigestAt() || new Date(Date.now() - 86_400_000).toISOString();
  const fresh = jobsTable()
    .all()
    .filter((j) => j.createdAt > since && j.score >= settings.automation.digestThreshold && (j.stage === 'discovered' || j.stage === 'saved'))
    .sort((a, b) => b.score - a.score)
    .map(toSummary);
  const soon = upcoming(2);
  const now = new Date().toISOString();
  if (!fresh.length && !soon.length) {
    setLastDigestAt(now);
    return;
  }
  const to = currentUserEmail();
  if (!to || remainingMailQuota() < 1) {
    log.warn('digest.skipped', { reason: to ? 'mail quota' : 'no email' });
    return;
  }
  const digest = buildDigest(fresh, { name: getProfile().name, threshold: settings.automation.digestThreshold, appUrl: webAppUrl(), upcoming: soon });
  if (!digest) return;
  sendMail(to, digest.subject, digest.text, digest.html);
  setLastDigestAt(now);
  logActivity('', 'digest', `Digest emailed: ${fresh.length} new matches, ${soon.length} things due soon`);
}
