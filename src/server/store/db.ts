/**
 * Table definitions (mirroring supabase/migrations) and per-request access.
 * Every user's rows live in shared Postgres tables, isolated by user_id and
 * row-level security.
 */
import type { ActivityEntry, Job, JobSummary } from '../../shared/types';
import { log } from '../log';
import { ctx } from '../platform/context';
import { Table, type TableDef } from './table';

/** Row shape of the lean jobs table, read on almost every request. */
export type JobRow = JobSummary & { canonicalUrl: string; roleKey: string };

/** Heavy text lives separately so list views never read it. */
export interface JobTextRow {
  id: string;
  description: string;
  requirements: string;
  local: Job['local'];
  /** When we last tried to fetch a fuller description from the posting page. */
  enrichedAt?: string;
}

export interface DocRow {
  id: string;
  coverLetter: string;
  updatedAt: string;
}

export const JOBS: TableDef = {
  name: 'jobs',
  orderBy: 'createdAt',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'company', type: 'string' },
    { key: 'role', type: 'string' },
    { key: 'location', type: 'string' },
    { key: 'workMode', type: 'string' },
    { key: 'stage', type: 'string' },
    { key: 'score', type: 'number' },
    { key: 'starred', type: 'bool' },
    { key: 'url', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'sourceLabel', type: 'string' },
    { key: 'sourceRef', type: 'string' },
    { key: 'tags', type: 'json', empty: [] },
    { key: 'postedAt', type: 'date' },
    { key: 'deadline', type: 'string' },
    { key: 'deadlineText', type: 'string' },
    { key: 'stageChangedAt', type: 'date' },
    { key: 'appliedAt', type: 'date' },
    { key: 'followUpAt', type: 'string' },
    { key: 'notes', type: 'string' },
    { key: 'snippet', type: 'string' },
    { key: 'match', type: 'json', column: 'match_result' },
    { key: 'aiStatus', type: 'string' },
    { key: 'aiError', type: 'string' },
    { key: 'aiAttempts', type: 'number' },
    { key: 'canonicalUrl', type: 'string' },
    { key: 'roleKey', type: 'string' },
    { key: 'createdAt', type: 'date' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const JOB_TEXT: TableDef = {
  name: 'job_texts',
  orderBy: 'id',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'description', type: 'string' },
    { key: 'requirements', type: 'string' },
    { key: 'local', type: 'json', column: 'local_match' },
    { key: 'enrichedAt', type: 'date' },
  ],
};

export const DOCS: TableDef = {
  name: 'cover_letters',
  orderBy: 'updatedAt',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'coverLetter', type: 'string' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const ACTIVITY: TableDef = {
  name: 'activity',
  orderBy: 'at',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'at', type: 'date' },
    { key: 'jobId', type: 'string' },
    { key: 'type', type: 'string' },
    { key: 'message', type: 'string' },
  ],
};

export const PROGRAMS: TableDef = {
  name: 'programs',
  orderBy: 'createdAt',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'name', type: 'string' },
    { key: 'org', type: 'string' },
    { key: 'region', type: 'string' },
    { key: 'stage', type: 'string' },
    { key: 'deadline', type: 'string' },
    { key: 'deadlineText', type: 'string' },
    { key: 'confirmed', type: 'bool' },
    { key: 'funding', type: 'string' },
    { key: 'money', type: 'string' },
    { key: 'fit', type: 'string' },
    { key: 'starred', type: 'bool' },
    { key: 'url', type: 'string' },
    { key: 'requirements', type: 'string' },
    { key: 'note', type: 'string' },
    { key: 'myNotes', type: 'string' },
    { key: 'docs', type: 'json', empty: {} },
    { key: 'key', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'createdAt', type: 'date' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const EXAMS: TableDef = {
  name: 'exams',
  orderBy: 'createdAt',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'name', type: 'string' },
    { key: 'body', type: 'string' },
    { key: 'category', type: 'string' },
    { key: 'stage', type: 'string' },
    { key: 'starred', type: 'bool' },
    { key: 'field', type: 'string' },
    { key: 'forYou', type: 'string' },
    { key: 'forYouNote', type: 'string' },
    { key: 'confidence', type: 'string' },
    { key: 'events', type: 'json', empty: [] },
    { key: 'eligibility', type: 'string' },
    { key: 'age', type: 'string' },
    { key: 'url', type: 'string' },
    { key: 'notes', type: 'string' },
    { key: 'myNotes', type: 'string' },
    { key: 'applicationNo', type: 'string' },
    { key: 'key', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'createdAt', type: 'date' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const TASKS: TableDef = {
  name: 'tasks',
  orderBy: 'createdAt',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'title', type: 'string' },
    { key: 'due', type: 'string' },
    { key: 'allDay', type: 'bool' },
    { key: 'area', type: 'string' },
    { key: 'status', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'link', type: 'string' },
    { key: 'notes', type: 'string' },
    { key: 'refType', type: 'string' },
    { key: 'refId', type: 'string' },
    { key: 'mailId', type: 'string' },
    { key: 'createdAt', type: 'date' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const MAIL: TableDef = {
  name: 'mail_items',
  orderBy: 'date',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'date', type: 'date', column: 'received_at' },
    { key: 'category', type: 'string' },
    { key: 'status', type: 'string' },
    { key: 'subject', type: 'string' },
    { key: 'fromName', type: 'string' },
    { key: 'from', type: 'string', column: 'sender' },
    { key: 'company', type: 'string' },
    { key: 'role', type: 'string' },
    { key: 'due', type: 'string' },
    { key: 'allDay', type: 'bool' },
    { key: 'area', type: 'string' },
    { key: 'suggestedStage', type: 'string' },
    { key: 'jobId', type: 'string' },
    { key: 'taskId', type: 'string' },
    { key: 'snippet', type: 'string' },
    { key: 'threadId', type: 'string' },
    { key: 'url', type: 'string' },
    { key: 'createdAt', type: 'date' },
  ],
};

export const ALL_TABLES = [JOBS, JOB_TEXT, DOCS, ACTIVITY, PROGRAMS, EXAMS, TASKS, MAIL];

export function table<T extends { id: string }>(def: TableDef): Table<T> {
  const c = ctx();
  let t = c.tables.get(def.name) as Table<T> | undefined;
  if (!t) {
    t = new Table<T>(def);
    c.tables.set(def.name, t);
  }
  return t;
}

/**
 * Forget cached reads. Call right after taking the lock when work done outside
 * the lock (network, AI) must be merged onto the latest data.
 */
export function dropTableCache(): void {
  for (const t of ctx().tables.values()) (t as Table<{ id: string }>).forget();
}

export function queueActivity(entry: ActivityEntry): void {
  ctx().activity.push(entry);
}

/** Write buffered activity in one call. Never throws: logging must not break a request. */
export async function flushActivity(): Promise<void> {
  const c = ctx();
  const pending = c.activity;
  if (!pending.length) return;
  c.activity = [];
  try {
    const t = table<ActivityEntry>(ACTIVITY);
    await t.insert(pending);
    // Trimming is a separate query; doing it now and then keeps the log bounded.
    if (Math.random() < 0.1) await t.trim(3000);
  } catch (e) {
    log.warn('activity.flush_failed', { message: String(e) });
  }
}
