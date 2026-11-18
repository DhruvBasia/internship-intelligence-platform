/**
 * One-time clean-up after the email classifier improves: re-reads emails that
 * were already processed and fixes what earlier versions got wrong. It only
 * touches things InternIQ created by itself and the student has not edited:
 *
 * - job alerts, promos and hackathon emails tracked as applications → removed
 * - company / role names ("Sclaria successfully submitted" → "Sclaria")
 * - "Finish your application" reminders counted as Applied → Saved
 * - the same application tracked twice (e.g. an email and its forward) → merged
 * - emails now recognised as noise → out of "Needs attention", with their auto-tasks
 */
import { roleKey, truncate } from '../../shared/text';
import type { ActivityEntry, MailItem, Stage } from '../../shared/types';
import { log } from '../log';
import { ctx } from '../platform/context';
import { currentUserEmail, props, withUserLock } from '../runtime';
import { ACTIVITY, table, type JobRow } from '../store/db';
import { jobsTable, logActivity } from '../store/jobs';
import { mailTable, tasksTable } from '../store/records';
import { getSettings } from '../store/userState';
import { classifyMail, hasJobContext, isEventMail, mailCompany } from './classify';

export const REPAIR_VERSION = '2';
const PROP = 'mail.repair';

const STAGE_RANK: Record<Stage, number> = { discovered: 0, saved: 1, applied: 2, interviewing: 3, offer: 4, rejected: 5, archived: -1 };

export interface RepairReport {
  renamed: number;
  removed: number;
  merged: number;
  restaged: number;
  ignored: number;
}

export function repairNeeded(): boolean {
  return props.get(PROP) !== REPAIR_VERSION;
}

export async function repairEmailTracking(): Promise<RepairReport> {
  const report: RepairReport = { renamed: 0, removed: 0, merged: 0, restaged: 0, ignored: 0 };
  const selfEmail = ctx().gmail?.email || currentUserEmail();
  const extraSenders = getSettings().mail.extraSenders;
  await withUserLock(async () => {
    const mt = mailTable();
    const jt = jobsTable();
    const tt = tasksTable();
    const mails = await mt.all();
    if (!mails.length) return;
    const jobs = await jt.all();
    const tasks = await tt.all();
    // A job counts as edited if the student changed its stage, notes or letter themselves.
    const activity = await table<ActivityEntry>(ACTIVITY).latest(3000);
    const edited = new Set(
      activity.filter((a) => a.jobId && (a.type === 'note' || a.type === 'letter' || (a.type === 'stage' && !/^From email/.test(a.message)))).map((a) => a.jobId),
    );

    const mailPatch = new Map<string, MailItem>();
    const patchMail = (m: MailItem, change: Partial<MailItem>) => mailPatch.set(m.id, { ...(mailPatch.get(m.id) ?? m), ...change });
    const jobPatch = new Map<string, JobRow>();
    const removeJobs = new Set<string>();
    const removeTasks = new Set<string>();

    for (const m of mails) {
      // Only subject and snippet are stored, so act on positive evidence only, never on
      // something the full body might have explained.
      const cls = classifyMail(
        { id: m.id, threadId: m.threadId, from: m.fromName && m.fromName !== m.from ? `${m.fromName} <${m.from}>` : m.from, subject: m.subject, date: m.date, snippet: m.snippet, body: '' },
        { extraSenders, selfEmail },
      );
      const event = isEventMail(cls.cleanSubject, m.fromName);
      const fakeInterview = (m.category === 'interview' || m.category === 'assessment') && !hasJobContext(`${cls.cleanSubject}\n${m.snippet}\n${m.fromName}\n${m.from}`);
      const notApplication = cls.noise || event || fakeInterview;
      if (notApplication && m.status === 'new') {
        patchMail(m, { status: cls.noise ? 'ignored' : 'done' });
        report.ignored++;
        for (const t of tasks) if (t.mailId === m.id && t.source === 'mail' && t.status === 'todo') removeTasks.add(t.id);
      }
      const job = jobs.find((j) => j.sourceLabel === 'From email' && j.sourceRef === m.id);
      if (!job || edited.has(job.id)) continue;
      if (notApplication) {
        removeJobs.add(job.id);
        report.removed++;
        continue;
      }
      const fromHeader = m.fromName && m.fromName !== m.from ? `${m.fromName} <${m.from}>` : m.from;
      const company = cls.company || mailCompany(m.subject, fromHeader, { selfEmail }) || job.company;
      // Roles that were just the email subject get the cleaned-up version; real role names stay.
      const subjectRole = job.role === truncate(m.subject, 120) || /^\s*(re|fwd?|fw)\s*:/i.test(job.role);
      const role = subjectRole ? cls.role || truncate(cls.cleanSubject, 120) : job.role;
      const stage: Stage = cls.category === 'eligible' && cls.suggestedStage === 'saved' && job.stage === 'applied' && /finish|complete|continue|don'?t forget|still accepting/i.test(cls.cleanSubject) ? 'saved' : job.stage;
      if (stage !== job.stage) report.restaged++;
      if (company !== job.company || role !== job.role) report.renamed++;
      if (company !== job.company || role !== job.role || stage !== job.stage) {
        jobPatch.set(job.id, { ...job, company, role, stage, roleKey: roleKey(company, role), updatedAt: new Date().toISOString() });
      }
    }

    // Merge duplicates among untouched email-created jobs (same company and role): keep the furthest along.
    const groups = new Map<string, JobRow[]>();
    for (const j of jobs) {
      if (j.sourceLabel !== 'From email' || removeJobs.has(j.id) || edited.has(j.id)) continue;
      const row = jobPatch.get(j.id) ?? j;
      const key = roleKey(row.company, row.role);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || a.createdAt.localeCompare(b.createdAt));
      const keep = group[0]!;
      for (const dupe of group.slice(1)) {
        removeJobs.add(dupe.id);
        jobPatch.delete(dupe.id);
        report.merged++;
        for (const m of mails) if (m.jobId === dupe.id) patchMail(m, { jobId: keep.id });
      }
    }

    // Emails and tasks that pointed at removed jobs.
    for (const m of mails) {
      const current = mailPatch.get(m.id) ?? m;
      if (current.jobId && removeJobs.has(current.jobId)) patchMail(m, { jobId: '' });
    }
    for (const t of tasks) if (t.refType === 'job' && removeJobs.has(t.refId) && t.source === 'mail' && t.status === 'todo') removeTasks.add(t.id);

    if (jobPatch.size) await jt.update(Array.from(jobPatch.values()));
    if (removeJobs.size) await jt.remove(Array.from(removeJobs));
    if (removeTasks.size) await tt.remove(Array.from(removeTasks));
    if (mailPatch.size) await mt.update(Array.from(mailPatch.values()));
    if (report.renamed + report.removed + report.merged + report.restaged + report.ignored) {
      logActivity(
        '',
        'refresh',
        `Email tidy-up: ${report.renamed} renamed, ${report.merged} duplicates merged, ${report.removed} non-applications removed, ${report.restaged} moved back to Saved, ${report.ignored} emails cleared from Needs attention`,
      );
      log.info('mail.repaired', { ...report });
    }
  });
  props.set(PROP, REPAIR_VERSION);
  return report;
}
