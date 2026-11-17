/**
 * RPC handlers. Every argument arrives from the browser and is validated here;
 * nothing below this layer trusts client input.
 */
import { APP_VERSION, LIMITS } from '../shared/defaults';
import { profileHash, scoreLocally } from '../shared/match';
import { canonicalUrl, roleKey, safeHttpUrl, toDay } from '../shared/text';
import {
  STAGES,
  type ActivityEntry,
  type AiProvider,
  type BootstrapData,
  type CoverLetterOptions,
  type DeepPartial,
  type ImportResult,
  type JobInput,
  type JobPatch,
  type JobSummary,
  type Profile,
  type Settings,
  type Stage,
} from '../shared/types';
import { writeCoverLetter } from './ai/analyze';
import { getClient, listModelsFor, requireClient } from './ai/client';
import { templateLetter } from './ai/prompts';
import { syncTriggers } from './automation';
import { AppError, badInput, notFound } from './errors';
import { currentUserEmail, props, triggers, withUserLock } from './gas';
import { parseDelimited, rowsToRawJobs } from './importers';
import { hasV1Data, importFromSheetUrl, migrateV1InPlace } from './migrate';
import { deadlineIn, processAiQueue, refresh } from './pipeline';
import { enrichDescriptions, readPosting, resolveBoard as resolveBoardSource } from './sources';
import { starterPackTsv } from './starterPack';
import { ACTIVITY, dropTableCache, forgetSpreadsheet, sheetUrl, table, type JobRow } from './store/db';
import {
  activityTable,
  assembleJob,
  docsTable,
  getTexts,
  insertRawJobs,
  jobsTable,
  logActivity,
  rescoreAllLocally,
  snippetOf,
  textTable,
  toSummary,
  type RawJob,
} from './store/jobs';
import * as user from './store/userState';

// ---------------------------------------------------------------------------
// Validation helpers

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw badInput(`${field} is required.`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw badInput(`${field} must be text.`);
  const s = String(v).trim();
  if (required && !s) throw badInput(`${field} is required.`);
  if (s.length > max) throw badInput(`${field} is too long (max ${max} characters).`);
  return s;
}

function jobId(v: unknown): string {
  const s = text(v, 'Job id', 40, true);
  if (!/^[a-z]_[a-z0-9]{6,20}$/i.test(s)) throw badInput('Invalid job id.');
  return s;
}

function jobIds(v: unknown, max: number = LIMITS.maxJobsPerBulk): string[] {
  if (!Array.isArray(v) || !v.length) throw badInput('Select at least one job.');
  if (v.length > max) throw badInput(`At most ${max} jobs at a time.`);
  return Array.from(new Set(v.map(jobId)));
}

function stage(v: unknown): Stage {
  if (!(STAGES as readonly string[]).includes(String(v))) throw badInput('Unknown stage.');
  return v as Stage;
}

function plainObject(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badInput(`${field} must be an object.`);
  return v as Record<string, unknown>;
}

function provider(v: unknown): Exclude<AiProvider, 'none'> {
  if (v !== 'gemini' && v !== 'openai_compat') throw badInput('Unknown AI provider.');
  return v;
}

function dateOrEmpty(v: unknown, field: string): string {
  const s = text(v, field, 40);
  if (!s) return '';
  const d = toDay(s);
  if (!d) throw badInput(`${field} must be a date (YYYY-MM-DD).`);
  return d;
}

function requireRow(id: string): JobRow {
  const row = jobsTable().get(id);
  if (!row) throw notFound('That job');
  return row;
}

function recentActivity(limit: number, jobFilter?: string): ActivityEntry[] {
  const all = table<ActivityEntry>(ACTIVITY).all();
  const out: ActivityEntry[] = [];
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    if (!jobFilter || all[i]!.jobId === jobFilter) out.push(all[i]!);
  }
  return out;
}

const summaries = (): JobSummary[] => jobsTable().all().map(toSummary);

// ---------------------------------------------------------------------------
// Session

export function bootstrap(): BootstrapData {
  let migrated = user.getV1Migrated();
  if (!migrated && hasV1Data()) migrated = withUserLock(() => migrateV1InPlace());
  const settings = user.getSettings();
  return {
    version: APP_VERSION,
    user: { email: currentUserEmail() },
    profile: user.getProfile(),
    settings: user.settingsView(settings),
    usage: user.getUsage(settings),
    jobs: summaries(),
    activity: recentActivity(40),
    sheetUrl: sheetUrl(),
    lastRefresh: user.getLastRefresh(),
    migratedFromV1: migrated,
  };
}

export function saveProfile(input: unknown): { profile: Profile; jobs: JobSummary[] } {
  const p = plainObject(input, 'Profile') as Partial<Profile>;
  const before = profileHash(user.getProfile());
  if (typeof p.resumeText === 'string' && p.resumeText.length > LIMITS.resumeChars) {
    throw badInput(`Resume text is too long (max ${LIMITS.resumeChars} characters). Paste the most relevant parts.`);
  }
  const profile = user.saveProfile(p);
  const after = profileHash(profile);
  if (before !== after) {
    withUserLock(() => {
      dropTableCache();
      rescoreAllLocally(profile, after);
    });
    logActivity('', 'settings', 'Profile updated; free scores recalculated');
  }
  return { profile, jobs: summaries() };
}

export function saveSettings(patch: unknown): { settings: ReturnType<typeof user.settingsView> } {
  const before = user.getSettings();
  const next = user.saveSettings(plainObject(patch, 'Settings') as DeepPartial<Settings>);
  if (JSON.stringify(before.automation) !== JSON.stringify(next.automation)) syncTriggers(next);
  return { settings: user.settingsView(next) };
}

export function completeOnboarding() {
  return { settings: user.settingsView(user.saveSettings({ onboarded: true })) };
}

// ---------------------------------------------------------------------------
// AI configuration

export function setSecret(providerArg: unknown, keyArg: unknown) {
  const p = provider(providerArg);
  const key = text(keyArg, 'API key', 300, true);
  if (/\s/.test(key) || key.length < 16) throw badInput('That does not look like an API key. Copy it again from the provider.');
  const settings = { ...user.getSettings(), ai: { ...user.getSettings().ai, provider: p } };
  // Listing models proves the key works before we store it.
  const models = listModelsFor(settings, key);
  user.setSecret(p, key);
  const current = user.getSettings();
  const keepModel = current.ai.provider === p && models.some((m) => m.id === current.ai.model);
  const next = user.saveSettings({ ai: { provider: p, model: keepModel ? current.ai.model : models[0]?.id ?? '' } });
  logActivity('', 'settings', `AI connected (${p === 'gemini' ? 'Gemini' : 'OpenAI-compatible'})`);
  return { settings: user.settingsView(next), models };
}

export function clearSecret(providerArg: unknown) {
  const p = provider(providerArg);
  user.clearSecret(p);
  const s = user.getSettings();
  const next = s.ai.provider === p ? user.saveSettings({ ai: { provider: 'none', model: '' } }) : s;
  return { settings: user.settingsView(next) };
}

export function listModels() {
  return { models: listModelsFor(user.getSettings()) };
}

export function testAi() {
  const settings = user.getSettings();
  if (user.remainingAiRequests(settings) <= 0) throw new AppError('AI_QUOTA', 'Daily AI limit reached; try again tomorrow.');
  const client = requireClient(settings);
  const t0 = Date.now();
  client.text('You are a health check. Reply with exactly: OK', 'Ping');
  user.recordUsage(1, 0, settings);
  return { model: client.model, ms: Date.now() - t0 };
}

export function getUsage() {
  return { usage: user.getUsage() };
}

// ---------------------------------------------------------------------------
// Jobs

export function listJobs() {
  return { jobs: summaries() };
}

export function getJob(idArg: unknown) {
  const id = jobId(idArg);
  let row = requireRow(id);
  let jobText = getTexts([id]).get(id);
  // Title-only postings: try once to fetch the full description from the page.
  if (row.url && (jobText?.description ?? '').length < 300 && !jobText?.enrichedAt) {
    const found = enrichDescriptions([{ id, url: row.url }]).get(id);
    const now = new Date().toISOString();
    withUserLock(() => {
      dropTableCache();
      const fresh = jobsTable().get(id);
      if (!fresh) return;
      if (found) {
        const local = scoreLocally({ ...fresh, tags: fresh.tags ?? [], description: found.description, requirements: found.requirements }, user.getProfile());
        const keepAi = fresh.match?.method === 'ai';
        row = { ...fresh, snippet: snippetOf(found.description, found.requirements), match: keepAi ? fresh.match : local, score: keepAi ? fresh.score : local.score };
        jobsTable().update([row]);
        jobText = { id, description: found.description, requirements: found.requirements, local, enrichedAt: now };
      } else {
        jobText = { id, description: jobText?.description ?? '', requirements: jobText?.requirements ?? '', local: jobText?.local ?? null, enrichedAt: now };
      }
      textTable().upsert([jobText]);
    });
  }
  const letter = docsTable().get(id)?.coverLetter ?? '';
  return { job: assembleJob(row, jobText), coverLetter: letter, activity: recentActivity(30, id) };
}

export function createJob(inputArg: unknown) {
  const input = plainObject(inputArg, 'Job') as Partial<JobInput>;
  const url = text(input.url, 'URL', 2000);
  if (url && !safeHttpUrl(url)) throw badInput('The link must start with http:// or https://');
  const raw: RawJob = {
    source: 'manual',
    sourceLabel: 'Added by you',
    sourceRef: '',
    url: safeHttpUrl(url),
    company: text(input.company, 'Company', 160, true),
    role: text(input.role, 'Role', 200, true),
    location: text(input.location, 'Location', 200),
    description: text(input.description, 'Description', LIMITS.descriptionChars),
    requirements: text(input.requirements, 'Requirements', LIMITS.requirementsChars),
    postedAt: '',
    deadline: dateOrEmpty(input.deadline, 'Deadline'),
    deadlineText: '',
    tags: [],
    stage: input.stage === undefined ? 'saved' : stage(input.stage),
    notes: text(input.notes, 'Notes', LIMITS.notesChars),
  };
  const rows = withUserLock(() => insertRawJobs([raw], user.getProfile(), { activity: 'created' }));
  if (!rows.length) throw new AppError('CONFLICT', `You're already tracking ${raw.role} at ${raw.company}.`);
  return { job: toSummary(rows[0]!) };
}

const EDITABLE: (keyof JobPatch)[] = ['stage', 'starred', 'notes', 'deadline', 'followUpAt', 'company', 'role', 'location', 'url', 'description', 'requirements'];

export function updateJob(idArg: unknown, patchArg: unknown) {
  const id = jobId(idArg);
  const patch = plainObject(patchArg, 'Changes') as JobPatch;
  const unknownKeys = Object.keys(patch).filter((k) => !EDITABLE.includes(k as keyof JobPatch));
  if (unknownKeys.length) throw badInput(`Cannot edit: ${unknownKeys.join(', ')}`);
  return withUserLock(() => {
    const row = requireRow(id);
    const now = new Date().toISOString();
    const next: JobRow = { ...row, updatedAt: now };
    if (patch.stage !== undefined) {
      const s = stage(patch.stage);
      if (s !== row.stage) {
        next.stage = s;
        next.stageChangedAt = now;
        if (s === 'applied' && !row.appliedAt) next.appliedAt = now;
        logActivity(id, 'stage', `${row.role} at ${row.company} → ${s}`);
      }
    }
    if (patch.starred !== undefined) next.starred = patch.starred === true;
    if (patch.notes !== undefined) next.notes = text(patch.notes, 'Notes', LIMITS.notesChars);
    if (patch.deadline !== undefined) {
      next.deadline = dateOrEmpty(patch.deadline, 'Deadline');
      if (next.deadline) next.deadlineText = '';
    }
    if (patch.followUpAt !== undefined) next.followUpAt = dateOrEmpty(patch.followUpAt, 'Follow-up date');
    if (patch.company !== undefined) next.company = text(patch.company, 'Company', 160, true);
    if (patch.role !== undefined) next.role = text(patch.role, 'Role', 200, true);
    if (patch.location !== undefined) next.location = text(patch.location, 'Location', 200);
    if (patch.url !== undefined) {
      const u = text(patch.url, 'URL', 2000);
      if (u && !safeHttpUrl(u)) throw badInput('The link must start with http:// or https://');
      next.url = safeHttpUrl(u);
    }
    const textChanged = patch.description !== undefined || patch.requirements !== undefined;
    const identityChanged = ['company', 'role', 'location'].some((k) => patch[k as keyof JobPatch] !== undefined);
    if (textChanged || identityChanged) {
      const current = getTexts([id]).get(id);
      const description = patch.description !== undefined ? text(patch.description, 'Description', LIMITS.descriptionChars) : current?.description ?? '';
      const requirements = patch.requirements !== undefined ? text(patch.requirements, 'Requirements', LIMITS.requirementsChars) : current?.requirements ?? '';
      const local = scoreLocally({ ...next, tags: next.tags ?? [], description, requirements }, user.getProfile());
      if (next.match?.method !== 'ai') {
        next.match = local;
        next.score = local.score;
      }
      next.snippet = snippetOf(description, requirements);
      textTable().upsert([{ id, description, requirements, local, enrichedAt: current?.enrichedAt ?? '' }]);
    }
    jobsTable().update([next]);
    if (patch.notes !== undefined && patch.notes !== row.notes) logActivity(id, 'note', 'Notes updated');
    return { job: toSummary(next) };
  });
}

export function bulkUpdate(idsArg: unknown, patchArg: unknown) {
  const ids = jobIds(idsArg);
  const patch = plainObject(patchArg, 'Changes') as JobPatch;
  const newStage = patch.stage === undefined ? undefined : stage(patch.stage);
  const star = patch.starred === undefined ? undefined : patch.starred === true;
  if (newStage === undefined && star === undefined) throw badInput('Nothing to change.');
  return withUserLock(() => {
    const t = jobsTable();
    const now = new Date().toISOString();
    const updates = ids
      .map((id) => t.get(id))
      .filter((r): r is JobRow => Boolean(r))
      .map((r) => {
        const next = { ...r, updatedAt: now };
        if (newStage && newStage !== r.stage) {
          next.stage = newStage;
          next.stageChangedAt = now;
          if (newStage === 'applied' && !r.appliedAt) next.appliedAt = now;
        }
        if (star !== undefined) next.starred = star;
        return next;
      });
    t.update(updates);
    if (newStage) logActivity('', 'stage', `${updates.length} jobs moved to ${newStage}`);
    return { jobs: updates.map(toSummary) };
  });
}

export function deleteJobs(idsArg: unknown) {
  const ids = jobIds(idsArg);
  return withUserLock(() => {
    const deleted = jobsTable().remove(ids);
    textTable().remove(deleted);
    docsTable().remove(deleted);
    if (deleted.length) logActivity('', 'deleted', `Deleted ${deleted.length} job${deleted.length === 1 ? '' : 's'}`);
    return { deleted };
  });
}

export function refreshNow() {
  const report = refresh({ deadline: deadlineIn(170_000), aiBudgetMs: 30_000 });
  return { report, jobs: summaries(), usage: user.getUsage() };
}

export function addFromUrl(urlArg: unknown) {
  const url = text(urlArg, 'URL', 2000, true);
  const raw = readPosting(url);
  if (!raw.role || !raw.company) throw new AppError('FETCH_FAILED', "Couldn't read the job title or company from that page. Add it manually instead.");
  const profile = user.getProfile();
  const result = withUserLock(() => {
    const rows = insertRawJobs([{ ...raw, stage: 'saved' }], profile, { activity: 'created' });
    if (rows.length) return { row: rows[0]!, duplicate: false };
    const url = canonicalUrl(raw.url);
    const key = roleKey(raw.company, raw.role);
    const match = jobsTable()
      .all()
      .find((r) => (url && r.canonicalUrl === url) || r.roleKey === key);
    if (!match) throw new AppError('CONFLICT', 'You are already tracking this posting.');
    return { row: match, duplicate: true };
  });
  let row = result.row;
  if (!result.duplicate && getClient(user.getSettings()) && user.remainingAiRequests() > 0) {
    try {
      processAiQueue({ ids: [row.id], deadline: deadlineIn(45_000) });
      dropTableCache();
      row = jobsTable().get(row.id) ?? row;
    } catch {
      /* AI is a bonus here; the job is saved either way */
    }
  }
  return { job: toSummary(row), duplicate: result.duplicate };
}

export function analyzeWithAi(idsArg: unknown) {
  const ids = jobIds(idsArg, 20);
  const out = processAiQueue({ ids, deadline: deadlineIn(240_000) });
  dropTableCache();
  const t = jobsTable();
  const jobs = ids.map((id) => t.get(id)).filter((r): r is JobRow => Boolean(r)).map(toSummary);
  return { jobs, usage: user.getUsage(), error: out.error };
}

export function rescoreAll() {
  const profile = user.getProfile();
  const result = withUserLock(() => {
    dropTableCache();
    return rescoreAllLocally(profile, profileHash(profile));
  });
  return { jobs: result.rows.map(toSummary), queued: 0 };
}

export function generateCoverLetter(idArg: unknown, optionsArg: unknown) {
  const id = jobId(idArg);
  const o = (optionsArg && typeof optionsArg === 'object' ? optionsArg : {}) as Partial<CoverLetterOptions>;
  const options: CoverLetterOptions = {
    tone: o.tone === 'enthusiastic' || o.tone === 'concise' ? o.tone : 'professional',
    length: o.length === 'short' ? 'short' : 'standard',
  };
  const row = requireRow(id);
  const settings = user.getSettings();
  const profile = user.getProfile();
  const client = getClient(settings);
  let textOut: string;
  let method: 'ai' | 'local' = 'local';
  if (!client) {
    textOut = templateLetter(profile, row, row.match);
  } else {
    if (user.remainingAiRequests(settings) <= 0) throw new AppError('AI_QUOTA', 'Daily AI limit reached. Try again tomorrow, or raise the limit in Settings → AI.');
    const t = getTexts([id]).get(id);
    textOut = writeCoverLetter(
      client,
      profile,
      { id, company: row.company, role: row.role, location: row.location, workMode: row.workMode, tags: row.tags ?? [], description: t?.description ?? '', requirements: t?.requirements ?? '' },
      options,
      row.match,
    );
    method = 'ai';
    user.recordUsage(1, 0, settings);
  }
  withUserLock(() => docsTable().upsert([{ id, coverLetter: textOut, updatedAt: new Date().toISOString() }]));
  logActivity(id, 'letter', method === 'ai' ? 'Cover letter drafted with AI' : 'Cover letter template created');
  return { text: textOut, method, usage: user.getUsage(settings) };
}

export function saveCoverLetter(idArg: unknown, textArg: unknown) {
  const id = jobId(idArg);
  const body = text(textArg, 'Cover letter', LIMITS.coverLetterChars);
  requireRow(id);
  const savedAt = new Date().toISOString();
  withUserLock(() => docsTable().upsert([{ id, coverLetter: body, updatedAt: savedAt }]));
  return { savedAt };
}

// ---------------------------------------------------------------------------
// Imports

function importRaws(raws: RawJob[], skipped: number, label: string): ImportResult {
  const rows = withUserLock(() => {
    dropTableCache();
    return insertRawJobs(raws, user.getProfile(), { activity: 'import' });
  });
  logActivity('', 'import', `${label}: ${rows.length} added, ${raws.length - rows.length + skipped} skipped`);
  return { added: rows.length, skipped: raws.length - rows.length + skipped, jobs: summaries() };
}

export function importTsv(textArg: unknown): ImportResult {
  const body = text(textArg, 'Import', LIMITS.tsvChars, true);
  let parsed;
  try {
    parsed = rowsToRawJobs(parseDelimited(body));
  } catch (e) {
    throw badInput(e instanceof Error ? e.message : 'Could not read that table.');
  }
  if (parsed.jobs.length > 2000) throw badInput('Import at most 2,000 rows at a time.');
  return importRaws(parsed.jobs, parsed.skipped, 'Spreadsheet import');
}

export function importStarterPack(): ImportResult {
  const parsed = rowsToRawJobs(parseDelimited(starterPackTsv()));
  const raws = parsed.jobs.map((j) => ({
    ...j,
    sourceLabel: 'Research programs',
    tags: ['Research program', ...j.tags],
    stage: 'discovered' as Stage,
    notes: 'Recurring programme: dates shift each cycle, so verify on the official page.' + (j.notes ? '\n' + j.notes : ''),
  }));
  return importRaws(raws, 0, 'Research programs pack');
}

export function importFromSheet(urlArg: unknown): ImportResult {
  const url = text(urlArg, 'Sheet URL', 2000, true);
  return withUserLock(() => importFromSheetUrl(url));
}

export function resolveBoard(inputArg: unknown) {
  return resolveBoardSource(text(inputArg, 'Company', 300, true));
}

export function getActivity(limitArg: unknown) {
  const limit = Math.max(1, Math.min(500, Number(limitArg) || 100));
  return { activity: recentActivity(limit) };
}

export function deleteAllData(confirmArg: unknown) {
  if (confirmArg !== 'DELETE') throw badInput('Type DELETE to confirm.');
  const url = sheetUrl();
  withUserLock(() => {
    jobsTable().clear();
    textTable().clear();
    docsTable().clear();
    activityTable().clear();
  });
  triggers.removeAll('worker');
  forgetSpreadsheet();
  props.deleteAll();
  return { sheetUrl: url };
}
