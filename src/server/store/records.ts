/**
 * Further studies, government exams, tasks and mail records, plus the
 * catalogue sync that keeps researched facts fresh without touching anything
 * the user changed (stage, notes, stars, documents).
 */
import { ABROAD_INTERNSHIPS } from '../catalog/abroadInternships';
import { EXAM_CATALOG, EXAM_CATALOG_DATE, type CatalogExam } from '../catalog/exams';
import { STUDY_CATALOG, STUDY_CATALOG_DATE, type CatalogRow } from '../catalog/studies';
import { PERSONAL } from '../flags';
import { props } from '../gas';
import { log } from '../log';
import { collapseWhitespace, safeHttpUrl, toDay, truncate } from '../../shared/text';
import type { Area, Exam, Funding, MailItem, Program, Task } from '../../shared/types';
import { EXAMS, MAIL, PROGRAMS, TASKS, table } from './db';
import { insertRawJobs, newId, type RawJob } from './jobs';
import { getProfile, saveProfile } from './userState';

export const programsTable = () => table<Program>(PROGRAMS);
export const examsTable = () => table<Exam>(EXAMS);
export const tasksTable = () => table<Task>(TASKS);
export const mailTable = () => table<MailItem>(MAIL);

const FUNDINGS: Funding[] = ['full', 'free', 'part', 'fee', 'none'];
const PROP_CATALOG = 'iip.catalogVersion';
const PROP_PERSONAL = 'iip.personalSeed';
const CATALOG_VERSION = `${STUDY_CATALOG_DATE}|${EXAM_CATALOG_DATE}|${STUDY_CATALOG.length}|${EXAM_CATALOG.length}`;

function programFacts(row: CatalogRow): Pick<Program, 'key' | 'region' | 'name' | 'org' | 'url' | 'deadlineText' | 'deadline' | 'confirmed' | 'funding' | 'money' | 'requirements'> {
  const [key, region, name, org, url, deadlineText, deadline, confirmed, funding, money, requirements] = row;
  return {
    key,
    region,
    name,
    org,
    url: safeHttpUrl(url),
    deadlineText,
    deadline: toDay(deadline),
    confirmed: confirmed === 1,
    funding: (FUNDINGS.includes(funding as Funding) ? funding : 'none') as Funding,
    money,
    requirements,
  };
}

function examFacts(c: CatalogExam): Omit<Exam, 'id' | 'stage' | 'starred' | 'myNotes' | 'applicationNo' | 'source' | 'createdAt' | 'updatedAt'> {
  const { key, name, body, category, field, eligibility, forYou, forYouNote, age, url, confidence, events, notes } = c;
  return { key, name, body, category, field, eligibility, forYou, forYouNote, age, url, confidence, events, notes };
}

function sameFacts(a: object, b: object): boolean {
  return Object.entries(b).every(([k, v]) => JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify(v));
}

/**
 * Insert new catalogue entries and refresh facts on existing catalogue rows.
 * Cheap no-op when the catalogue version has not changed. Caller holds the lock.
 */
export function syncCatalogs(force = false): { added: number } {
  if (!force && props.get(PROP_CATALOG) === CATALOG_VERSION) return { added: 0 };
  const now = new Date().toISOString();
  let added = 0;

  const pt = programsTable();
  const byKey = new Map(pt.all().map((p) => [p.key, p]));
  const fresh: Program[] = [];
  const changed: Program[] = [];
  for (const row of STUDY_CATALOG) {
    const facts = programFacts(row);
    const rating = PERSONAL?.ratings?.[facts.key];
    const existing = byKey.get(facts.key);
    if (!existing) {
      fresh.push({
        id: newId('p_'),
        ...facts,
        fit: rating?.fit ?? '',
        note: rating?.note ?? '',
        stage: PERSONAL?.programStages?.[facts.key] ?? 'shortlisted',
        starred: false,
        docs: {},
        myNotes: '',
        source: 'catalog',
        createdAt: now,
        updatedAt: now,
      });
    } else if (existing.source === 'catalog' && !sameFacts(existing, facts)) {
      changed.push({ ...existing, ...facts, updatedAt: now });
    }
  }
  pt.insert(fresh);
  pt.update(changed);
  added += fresh.length;

  const et = examsTable();
  const examsByKey = new Map(et.all().map((e) => [e.key, e]));
  const newExams: Exam[] = [];
  const changedExams: Exam[] = [];
  for (const c of EXAM_CATALOG) {
    const facts = examFacts(c);
    const existing = examsByKey.get(c.key);
    if (!existing) {
      newExams.push({
        id: newId('x_'),
        ...facts,
        stage: c.forYou === 'not-eligible' ? 'dropped' : 'watching',
        starred: false,
        myNotes: '',
        applicationNo: '',
        source: 'catalog',
        createdAt: now,
        updatedAt: now,
      });
    } else if (existing.source === 'catalog' && !sameFacts(existing, facts)) {
      changedExams.push({ ...existing, ...facts, updatedAt: now });
    }
  }
  et.insert(newExams);
  et.update(changedExams);
  added += newExams.length;

  props.set(PROP_CATALOG, CATALOG_VERSION);
  if (added || changed.length || changedExams.length) log.info('catalog.synced', { added, changed: changed.length + changedExams.length });
  return { added };
}

/**
 * True when this user's workspace needs no first-run work (sheet, schema,
 * catalogues, personal seed). Reads only user properties, so it is instant.
 */
export function workspaceReady(schemaVersion: string): boolean {
  if (!props.get('SPREADSHEET_ID') || props.get('iip.schema') !== schemaVersion) return false;
  if (props.get(PROP_CATALOG) !== CATALOG_VERSION) return false;
  if (PERSONAL && Number(props.get(PROP_PERSONAL) || 0) < PERSONAL.version) return false;
  return true;
}

/** Funded research internships abroad, as importable job postings. */
export function abroadInternshipRaws(): RawJob[] {
  return ABROAD_INTERNSHIPS.map((row) => {
    const f = programFacts(row);
    const comma = f.name.lastIndexOf(',');
    const company = comma > 0 ? f.name.slice(comma + 1).trim() : f.name.replace(/\s*\(.*\)$/, '');
    const rating = PERSONAL?.ratings?.[f.key];
    return {
      source: 'import',
      sourceLabel: 'Research internships abroad',
      sourceRef: f.key,
      url: f.url,
      company: truncate(company, 160),
      role: truncate(f.name, 200),
      location: f.org,
      description: [f.money && `Funding: ${f.money}`, f.requirements && `Requirements: ${f.requirements}`].filter(Boolean).join('\n'),
      requirements: f.requirements,
      postedAt: '',
      deadline: f.deadline,
      deadlineText: f.deadline ? '' : f.deadlineText,
      tags: ['internship', 'Research internship abroad', f.funding === 'full' ? 'Fully funded' : f.funding === 'part' ? 'Partly funded' : '', f.confirmed ? '' : 'Date unconfirmed'].filter(Boolean),
      stage: rating?.fit === 'skip' ? 'archived' : 'discovered',
      notes: [rating?.note, f.deadlineText && `Deadline as listed: ${f.deadlineText}`].filter(Boolean).join('\n'),
    } satisfies RawJob;
  });
}

/** One-time import of the deployer's private seed (profile, roadmap tasks, abroad internships). Caller holds the lock. */
export function applyPersonalSeedOnce(): boolean {
  if (!PERSONAL || Number(props.get(PROP_PERSONAL) || 0) >= PERSONAL.version) return false;
  const current = getProfile();
  if (PERSONAL.profile && !current.skills.length && !current.resumeText) {
    saveProfile({ ...current, ...PERSONAL.profile });
  }
  const now = new Date().toISOString();
  const tt = tasksTable();
  const existingTitles = new Set(tt.all().map((t) => t.title));
  const tasks: Task[] = (PERSONAL.tasks ?? [])
    .filter((t) => t.title && !existingTitles.has(t.title))
    .map((t) => ({
      id: newId('t_'),
      title: truncate(collapseWhitespace(t.title), 200),
      due: toDay(t.due),
      allDay: true,
      area: t.area,
      status: 'todo',
      source: 'roadmap',
      link: '',
      notes: t.notes ?? '',
      refType: '',
      refId: '',
      mailId: '',
      createdAt: now,
      updatedAt: now,
    }));
  tt.insert(tasks);
  insertRawJobs(abroadInternshipRaws(), getProfile(), { activity: 'import' });
  props.set(PROP_PERSONAL, String(PERSONAL.version));
  log.info('personal.seeded', { tasks: tasks.length });
  return true;
}

export function newTask(input: Partial<Task> & { title: string; area: Area }): Task {
  const now = new Date().toISOString();
  return {
    id: newId('t_'),
    title: truncate(collapseWhitespace(input.title), 200),
    due: input.due ?? '',
    allDay: input.allDay ?? true,
    area: input.area,
    status: 'todo',
    source: input.source ?? 'manual',
    link: safeHttpUrl(input.link),
    notes: input.notes ?? '',
    refType: input.refType ?? '',
    refId: input.refId ?? '',
    mailId: input.mailId ?? '',
    createdAt: now,
    updatedAt: now,
  };
}
