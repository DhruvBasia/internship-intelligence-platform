/**
 * Gmail scan (read-only) → classify → store, then optionally track applications
 * and create dated tasks. Only the extracted facts are stored (subject, sender,
 * a short snippet, dates); full bodies are read in memory and discarded.
 */
import { htmlToText, roleKey, truncate } from '../../shared/text';
import type { JobSummary, MailItem, MailReport, Stage, Task } from '../../shared/types';
import { AppError, errorMessage } from '../errors';
import { features } from '../flags';
import { log } from '../log';
import { ctx } from '../platform/context';
import { fromB64Url } from '../platform/crypto';
import { pool } from '../platform/http';
import type { Deadline } from '../pipeline';
import { currentUserEmail, props, withUserLock } from '../runtime';
import { dropTableCache, type JobRow } from '../store/db';
import { insertRawJobs, jobsTable, logActivity, toSummary } from '../store/jobs';
import { mailTable, newTask, tasksTable } from '../store/records';
import { getProfile, getSettings } from '../store/userState';
import { classifyMail, companyKey, mailQueries, type Classification, type RawMail } from './classify';
import { gmailGet } from './gmail';

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

const PROP_LAST = 'mail.lastScan';

export function mailStatus(): { ok: boolean; reason: string } {
  if (!features().mail) return { ok: false, reason: 'Gmail tracking is not set up on this InternIQ server yet.' };
  const g = ctx().gmail;
  if (!g) return { ok: false, reason: 'Connect Gmail first (Mail → Connect Gmail).' };
  if (g.status !== 'active') return { ok: false, reason: 'Gmail access was removed. Reconnect Gmail in the Mail tab.' };
  return { ok: true, reason: '' };
}

export function getLastMailScan(): MailReport | null {
  return props.getJson<MailReport | null>(PROP_LAST, null);
}

function decode(data: string): string {
  try {
    return new TextDecoder('utf-8').decode(fromB64Url(data));
  } catch {
    return '';
  }
}

function bodyOf(part: GmailPart | undefined): string {
  if (!part) return '';
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.body?.data) {
      if (/^text\/plain/i.test(p.mimeType ?? '')) plain.push(decode(p.body.data));
      else if (/^text\/html/i.test(p.mimeType ?? '')) html.push(decode(p.body.data));
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(part);
  const text = plain.join('\n').trim() || htmlToText(html.join('\n'));
  return truncate(text, 8000);
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function gmailUrl(threadId: string, email: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(email || '0')}/#all/${encodeURIComponent(threadId)}`;
}

const STAGE_RANK: Record<Stage, number> = { discovered: 0, saved: 1, applied: 2, interviewing: 3, offer: 4, rejected: 5, archived: -1 };

/** Should an email-suggested stage replace the current one? Never downgrades; an offer is never overwritten. */
export function shouldAdvance(current: Stage, suggested: Stage): boolean {
  if (current === suggested) return false;
  if (current === 'offer') return false;
  if (suggested === 'rejected') return current !== 'rejected';
  return STAGE_RANK[suggested] > STAGE_RANK[current];
}

function findJob(rows: JobRow[], company: string, role: string): JobRow | undefined {
  const ck = companyKey(company);
  if (ck.length < 2) return undefined;
  const same = rows.filter((r) => {
    const rk = companyKey(r.company);
    return rk === ck || (ck.length >= 4 && rk.length >= 4 && (rk.includes(ck) || ck.includes(rk)));
  });
  if (!same.length) return undefined;
  if (role) {
    const want = roleKey(company, role).split('|')[1] ?? '';
    const exact = same.find((r) => (r.roleKey.split('|')[1] ?? '') === want);
    if (exact) return exact;
  }
  return same.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function scanMail(opts: { deadline: Deadline }): Promise<{ report: MailReport; jobs: JobSummary[] }> {
  const status = mailStatus();
  if (!status.ok) throw new AppError('BAD_INPUT', status.reason);
  const settings = getSettings();
  const last = getLastMailScan();
  const days = last ? 3 : settings.mail.lookbackDays;
  const report: MailReport = { at: new Date().toISOString(), scanned: 0, added: 0, important: 0, jobsCreated: 0, jobsUpdated: 0, tasksCreated: 0, error: '' };

  const ids = new Map<string, string>();
  try {
    for (const q of mailQueries(days, settings.mail.extraSenders)) {
      const params = new URLSearchParams({ q, maxResults: String(last ? 25 : 60) });
      const res = await gmailGet<{ messages?: { id: string; threadId: string }[] }>(`messages?${params}`);
      for (const m of res.messages ?? []) ids.set(m.id, m.threadId);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('FETCH_FAILED', 'Could not search Gmail: ' + errorMessage(e).slice(0, 160));
  }
  report.scanned = ids.size;
  const known = new Set((await mailTable().getMany(Array.from(ids.keys()))).keys());
  const fresh = Array.from(ids.keys()).filter((id) => !known.has(id)).slice(0, last ? 60 : 150);

  const items: { raw: RawMail; cls: Classification }[] = [];
  let stopped = false;
  await pool(fresh, 5, async (id) => {
    if (Date.now() > opts.deadline.at - 15_000) {
      stopped = true;
      return;
    }
    try {
      const msg = await gmailGet<GmailMessage>(`messages/${encodeURIComponent(id)}?format=full`);
      const raw: RawMail = {
        id: msg.id,
        threadId: msg.threadId,
        from: header(msg, 'From'),
        subject: header(msg, 'Subject') || '(no subject)',
        date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
        snippet: msg.snippet ?? '',
        body: bodyOf(msg.payload),
      };
      items.push({ raw, cls: classifyMail(raw, { extraSenders: settings.mail.extraSenders }) });
    } catch (e) {
      log.warn('mail.get_failed', { message: errorMessage(e).slice(0, 200) });
    }
  });
  if (stopped) report.error = 'Stopped early to stay within the time limit; the rest will be read next scan.';

  const email = ctx().gmail?.email || currentUserEmail();
  const touchedJobs: JobRow[] = [];
  await withUserLock(async () => {
    dropTableCache();
    const mt = mailTable();
    const tt = tasksTable();
    const jt = jobsTable();
    const existingIds = new Set((await mt.getMany(items.map((i) => i.raw.id))).keys());
    const taskMailIds = new Set((await tt.all()).map((t) => t.mailId).filter(Boolean));
    const newMail: MailItem[] = [];
    const newTasks: Task[] = [];
    // Oldest first so later emails (e.g. a rejection after an interview) win.
    items.sort((a, b) => a.raw.date.localeCompare(b.raw.date));
    for (const { raw, cls } of items) {
      if (existingIds.has(raw.id)) continue;
      const url = gmailUrl(raw.threadId, email);
      const item: MailItem = {
        id: raw.id,
        threadId: raw.threadId,
        from: cls.fromAddress,
        fromName: cls.fromName,
        subject: truncate(raw.subject, 200),
        snippet: truncate(raw.snippet, 300),
        date: raw.date,
        category: cls.category,
        area: cls.area,
        company: cls.company,
        role: cls.role,
        due: cls.due,
        allDay: cls.allDay,
        suggestedStage: cls.suggestedStage,
        jobId: '',
        taskId: '',
        status: cls.noise ? 'ignored' : cls.important ? 'new' : 'done',
        url,
        createdAt: new Date().toISOString(),
      };
      if (cls.important) report.important++;

      if (!cls.noise && settings.mail.autoTrack && cls.area === 'internships' && cls.company && cls.suggestedStage) {
        const rows = await jt.all();
        const job = findJob(rows, cls.company, cls.role);
        if (job) {
          item.jobId = job.id;
          if (shouldAdvance(job.stage, cls.suggestedStage)) {
            const now = new Date().toISOString();
            const next: JobRow = {
              ...job,
              stage: cls.suggestedStage,
              stageChangedAt: now,
              appliedAt: job.appliedAt || (cls.suggestedStage === 'applied' ? raw.date : ''),
              notes: truncate(`${job.notes ? job.notes + '\n' : ''}${raw.date.slice(0, 10)} email: ${raw.subject}`, 10_000),
              updatedAt: now,
            };
            await jt.update([next]);
            touchedJobs.push(next);
            report.jobsUpdated++;
            logActivity(job.id, 'stage', `From email: ${job.role} at ${job.company} → ${cls.suggestedStage}`);
          }
        } else if (cls.suggestedStage !== 'rejected') {
          const created = await insertRawJobs(
            [
              {
                source: 'manual',
                sourceLabel: 'From email',
                sourceRef: raw.id,
                url: '',
                company: cls.company,
                role: cls.role || truncate(raw.subject, 120),
                location: '',
                description: truncate(raw.snippet, 600),
                requirements: '',
                postedAt: raw.date,
                deadline: cls.due ? cls.due.slice(0, 10) : '',
                deadlineText: '',
                tags: ['From email', cls.category],
                stage: cls.suggestedStage,
                appliedAt: cls.suggestedStage === 'applied' ? raw.date : '',
                notes: `Tracked from email: ${raw.subject}\n${url}`,
              },
            ],
            getProfile(),
            { activity: 'created' },
          );
          if (created[0]) {
            item.jobId = created[0].id;
            touchedJobs.push(created[0]);
            report.jobsCreated++;
          }
        }
      }

      if (!cls.noise && cls.due && cls.taskTitle && cls.due.slice(0, 10) >= today() && !taskMailIds.has(raw.id)) {
        const task = newTask({
          title: cls.taskTitle,
          due: cls.due,
          allDay: cls.allDay,
          area: cls.area,
          source: 'mail',
          link: url,
          notes: `${cls.fromName}: ${raw.subject}`,
          refType: item.jobId ? 'job' : '',
          refId: item.jobId,
          mailId: raw.id,
        });
        newTasks.push(task);
        item.taskId = task.id;
        report.tasksCreated++;
      }
      newMail.push(item);
    }
    await mt.insert(newMail);
    await tt.insert(newTasks);
    if (newMail.length) await mt.trim(2500);
    report.added = newMail.length;
  });
  props.setJson(PROP_LAST, report);
  if (report.added) logActivity('', 'refresh', `Email scan: ${report.added} new, ${report.jobsUpdated + report.jobsCreated} applications updated, ${report.tasksCreated} tasks added`);
  return { report, jobs: touchedJobs.map(toSummary) };
}
