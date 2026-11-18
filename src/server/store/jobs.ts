import { LIMITS } from '../../shared/defaults';
import { detectWorkMode, scoreLocally } from '../../shared/match';
import { canonicalUrl, collapseWhitespace, roleKey, safeHttpUrl, truncate } from '../../shared/text';
import type { ActivityEntry, ActivityType, Job, JobSummary, MatchResult, Profile, SourceKind, Stage } from '../../shared/types';
import { uuid } from '../runtime';
import { ACTIVITY, DOCS, JOB_TEXT, JOBS, queueActivity, table, type DocRow, type JobRow, type JobTextRow } from './db';

/** A posting as produced by a source adapter, before it becomes a tracked job. */
export interface RawJob {
  source: SourceKind;
  sourceLabel: string;
  sourceRef: string;
  url: string;
  company: string;
  role: string;
  location: string;
  description: string;
  requirements: string;
  postedAt: string;
  deadline: string;
  deadlineText: string;
  tags: string[];
  /** Which source task produced this posting (for per-source counts); not stored. */
  origin?: string;
  /** Imports may carry tracking state. */
  stage?: Stage;
  notes?: string;
  appliedAt?: string;
}

export const jobsTable = () => table<JobRow>(JOBS);
export const textTable = () => table<JobTextRow>(JOB_TEXT);
export const docsTable = () => table<DocRow>(DOCS);
export const activityTable = () => table<ActivityEntry>(ACTIVITY);

export function newId(prefix: string): string {
  return prefix + uuid().slice(0, 12);
}

export function logActivity(jobId: string, type: ActivityType, message: string): void {
  queueActivity({ id: newId('a_'), at: new Date().toISOString(), jobId, type, message: truncate(message, 300) });
}

export function snippetOf(description: string, requirements = ''): string {
  return truncate(collapseWhitespace(description || requirements), 280);
}

export function toSummary(row: JobRow): JobSummary {
  const { canonicalUrl: _c, roleKey: _r, ...summary } = row;
  return {
    ...summary,
    tags: Array.isArray(row.tags) ? row.tags : [],
    stage: (row.stage || 'discovered') as Stage,
    aiStatus: row.aiStatus || 'none',
  };
}

export function assembleJob(row: JobRow, text: JobTextRow | undefined): Job {
  const { snippet: _s, ...summary } = toSummary(row);
  return {
    ...summary,
    description: text?.description ?? '',
    requirements: text?.requirements ?? '',
    local: text?.local ?? null,
  };
}

/** Build a new tracked job (row + text) from a raw posting, scored locally. */
export function buildJob(raw: RawJob, profile: Profile, defaultStage: Stage = 'discovered'): { row: JobRow; text: JobTextRow } {
  const now = new Date().toISOString();
  const stage = raw.stage ?? defaultStage;
  const id = newId('j_');
  const url = safeHttpUrl(raw.url);
  const description = truncate(raw.description, LIMITS.descriptionChars);
  const requirements = truncate(raw.requirements, LIMITS.requirementsChars);
  const company = truncate(collapseWhitespace(raw.company), 160) || 'Unknown company';
  const role = truncate(collapseWhitespace(raw.role), 200) || 'Internship';
  const location = truncate(collapseWhitespace(raw.location), 200);
  const workMode = detectWorkMode(location, raw.tags.join(' ') + ' ' + description);
  const tags = raw.tags.filter(Boolean).map((t) => truncate(t, 60)).slice(0, 15);
  const local = scoreLocally({ company, role, location, workMode, description, requirements, tags }, profile);
  const row: JobRow = {
    id,
    company,
    role,
    location,
    workMode,
    stage,
    score: local.score,
    starred: false,
    url,
    source: raw.source,
    sourceLabel: raw.sourceLabel,
    sourceRef: raw.sourceRef,
    tags,
    postedAt: raw.postedAt,
    deadline: raw.deadline,
    deadlineText: truncate(raw.deadlineText, 80),
    stageChangedAt: now,
    appliedAt: raw.appliedAt || (stage === 'applied' ? now : ''),
    followUpAt: '',
    notes: truncate(raw.notes ?? '', LIMITS.notesChars),
    snippet: snippetOf(description, requirements),
    match: local,
    aiStatus: 'none',
    aiError: '',
    aiAttempts: 0,
    canonicalUrl: canonicalUrl(url),
    roleKey: roleKey(company, role),
    createdAt: now,
    updatedAt: now,
  };
  return { row, text: { id, description, requirements, local } };
}

/** Index for de-duplication by canonical URL and by company+role. */
export class DedupeIndex {
  private urls = new Set<string>();
  private keys = new Set<string>();

  constructor(rows: Pick<JobRow, 'canonicalUrl' | 'roleKey'>[]) {
    rows.forEach((r) => this.add(r.canonicalUrl, r.roleKey));
  }

  has(url: string, key: string): boolean {
    return (url !== '' && this.urls.has(url)) || (key !== '|' && this.keys.has(key));
  }

  add(url: string, key: string): void {
    if (url) this.urls.add(url);
    if (key && key !== '|') this.keys.add(key);
  }
}

/** Insert raw postings that are not already tracked. Returns the inserted rows. */
export async function insertRawJobs(raws: RawJob[], profile: Profile, opts: { stage?: Stage; activity?: ActivityType } = {}): Promise<JobRow[]> {
  const jobs = jobsTable();
  const index = new DedupeIndex(await jobs.all());
  const rows: JobRow[] = [];
  const texts: JobTextRow[] = [];
  for (const raw of raws) {
    const url = canonicalUrl(raw.url);
    const key = roleKey(raw.company, raw.role);
    if (index.has(url, key)) continue;
    index.add(url, key);
    const built = buildJob(raw, profile, opts.stage);
    rows.push(built.row);
    texts.push(built.text);
  }
  if (rows.length) {
    await jobs.insert(rows);
    await textTable().insert(texts);
    if (rows.length <= 25) rows.forEach((r) => logActivity(r.id, opts.activity ?? 'discovered', `${r.role} at ${r.company}`));
    else logActivity('', opts.activity ?? 'discovered', `${rows.length} new postings added`);
  }
  return rows;
}

export function getTexts(ids: string[]): Promise<Map<string, JobTextRow>> {
  return textTable().getMany(ids);
}

/** Recompute free scores for every job (fast, no network). Keeps AI results unless stale. */
export async function rescoreAllLocally(profile: Profile, hash: string): Promise<{ rows: JobRow[]; staleAi: number }> {
  const jobs = jobsTable();
  const texts = textTable();
  const rows = await jobs.all();
  const textMap = await texts.getMany(rows.map((r) => r.id));
  const updatedRows: JobRow[] = [];
  const updatedTexts: JobTextRow[] = [];
  let staleAi = 0;
  for (const row of rows) {
    const text = textMap.get(row.id);
    const local = scoreLocally(
      {
        company: row.company,
        role: row.role,
        location: row.location,
        workMode: row.workMode,
        description: text?.description ?? '',
        requirements: text?.requirements ?? '',
        tags: row.tags ?? [],
      },
      profile,
    );
    const ai = row.match && row.match.method === 'ai' ? row.match : null;
    let match: MatchResult = local;
    let aiStatus = row.aiStatus;
    if (ai && ai.profileHash === hash) {
      match = ai;
    } else if (ai) {
      staleAi++;
      aiStatus = 'none';
    }
    updatedRows.push({ ...row, match, score: match.score, aiStatus, updatedAt: new Date().toISOString() });
    updatedTexts.push({ id: row.id, description: text?.description ?? '', requirements: text?.requirements ?? '', local, enrichedAt: text?.enrichedAt ?? '' });
  }
  await jobs.update(updatedRows);
  await texts.upsert(updatedTexts);
  return { rows: await jobs.all(), staleAi };
}
