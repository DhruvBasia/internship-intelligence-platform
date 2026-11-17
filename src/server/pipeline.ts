/**
 * Refresh = fetch sources → filter for relevance → de-duplicate → insert with
 * free scores → (optionally) AI-analyse the most promising within budget.
 *
 * Network and AI calls happen outside the user lock; results are merged onto a
 * fresh read inside it, so a long refresh never blocks the UI and never
 * overwrites edits made meanwhile.
 */
import { isRelevant, profileHash, scoreLocally } from '../shared/match';
import { canonicalUrl, roleKey, truncate } from '../shared/text';
import type { MatchResult, Profile, RefreshReport, Settings } from '../shared/types';
import { analyzeBatch } from './ai/analyze';
import { getClient } from './ai/client';
import type { AnalysisInput } from './ai/prompts';
import { AppError, errorMessage } from './errors';
import { withUserLock } from './gas';
import { log } from './log';
import { enrichDescriptions, fetchSources } from './sources';
import { dropTableCache, type JobRow } from './store/db';
import { DedupeIndex, getTexts, insertRawJobs, jobsTable, logActivity, snippetOf, textTable, type RawJob } from './store/jobs';
import { getProfile, getSettings, recordUsage, remainingAiRequests, setLastRefresh } from './store/userState';

export interface Deadline {
  at: number;
}

export const deadlineIn = (ms: number): Deadline => ({ at: Date.now() + ms });
const timeLeft = (d: Deadline) => d.at - Date.now();

function asText(raw: RawJob) {
  return {
    company: raw.company,
    role: raw.role,
    location: raw.location,
    workMode: 'unknown' as const,
    description: raw.description,
    requirements: raw.requirements,
    tags: raw.tags,
  };
}

export function refresh(opts: { deadline: Deadline; aiBudgetMs: number }): RefreshReport {
  const settings = getSettings();
  const profile = getProfile();
  const startedAt = new Date().toISOString();
  const results = fetchSources(settings);

  // Relevance + cap, newest-first within each source (sources are already sorted).
  const existing = new DedupeIndex(jobsTable().all());
  const candidates: RawJob[] = [];
  let duplicates = 0;
  for (const r of results) {
    const relevant = r.jobs.filter((j) => isRelevant(asText(j), profile, settings.filters));
    r.report.relevant = relevant.length;
    for (const j of relevant) {
      j.origin = r.report.id;
      const url = canonicalUrl(j.url);
      const key = roleKey(j.company, j.role);
      if (existing.has(url, key)) {
        duplicates++;
        continue;
      }
      existing.add(url, key);
      candidates.push(j);
    }
  }
  // Interleave sources so one huge source cannot crowd out followed companies.
  const capped = interleaveBySource(candidates).slice(0, settings.filters.maxNewPerRefresh);

  const inserted = withUserLock(() => {
    dropTableCache();
    const rows = insertRawJobs(capped, profile);
    queueForAi(rows, settings);
    return rows;
  });
  const addedByOrigin = new Map<string, number>();
  const originOf = new Map(capped.map((c) => [canonicalUrl(c.url) + '|' + roleKey(c.company, c.role), c.origin ?? '']));
  for (const row of inserted) {
    const origin = originOf.get(row.canonicalUrl + '|' + row.roleKey) ?? '';
    addedByOrigin.set(origin, (addedByOrigin.get(origin) ?? 0) + 1);
  }
  results.forEach((r) => (r.report.added = addedByOrigin.get(r.report.id) ?? 0));

  let aiAnalyzed = 0;
  let aiError = '';
  const aiDeadline: Deadline = { at: Math.min(opts.deadline.at, Date.now() + opts.aiBudgetMs) };
  if (opts.aiBudgetMs > 0 && getClient(settings)) {
    const out = processAiQueue({ deadline: aiDeadline });
    aiAnalyzed = out.analyzed;
    aiError = out.error;
  }
  const aiQueued = jobsTable().all().filter((j) => j.aiStatus === 'queued').length;

  const report: RefreshReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sources: results.map((r) => r.report),
    added: inserted.length,
    duplicates,
    aiAnalyzed,
    aiQueued,
    aiError,
  };
  setLastRefresh(report);
  const failed = report.sources.filter((s) => s.error).map((s) => s.label);
  logActivity(
    '',
    'refresh',
    `Refresh: ${report.added} new` + (aiAnalyzed ? `, ${aiAnalyzed} analysed by AI` : '') + (failed.length ? `; failed: ${failed.join(', ')}` : ''),
  );
  log.info('refresh.done', { added: report.added, duplicates, aiAnalyzed, failed });
  return report;
}

function interleaveBySource(jobs: RawJob[]): RawJob[] {
  const groups = new Map<string, RawJob[]>();
  for (const j of jobs) {
    const k = j.origin ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(j);
  }
  const queues = Array.from(groups.values());
  const out: RawJob[] = [];
  for (let i = 0; out.length < jobs.length; i++) {
    for (const q of queues) if (q[i]) out.push(q[i]!);
  }
  return out;
}

/** Mark promising, never-analysed jobs for background AI analysis. Caller holds the lock. */
function queueForAi(rows: JobRow[], settings: Settings): void {
  // Only queue when a working client exists; otherwise jobs would sit "queued" forever.
  if (!settings.ai.autoAnalyze || !getClient(settings)) return;
  const toQueue = rows.filter((r) => r.aiStatus === 'none' && r.score >= settings.ai.autoMinScore && r.stage !== 'archived' && r.stage !== 'rejected');
  if (!toQueue.length) return;
  const t = jobsTable();
  t.update(toQueue.map((r) => ({ ...r, aiStatus: 'queued' as const })));
}

export interface AiRunResult {
  analyzed: number;
  error: string;
  ids: string[];
}

/**
 * Analyse queued jobs (or the given ids) with AI, batch by batch, until the
 * deadline, the daily budget or the provider's quota stops us.
 */
export function processAiQueue(opts: { deadline: Deadline; ids?: string[] }): AiRunResult {
  const settings = getSettings();
  const client = getClient(settings);
  if (!client) {
    if (opts.ids) throw new AppError('AI_NOT_CONFIGURED', 'AI is not set up yet. Add a free key in Settings → AI.');
    return { analyzed: 0, error: '', ids: [] };
  }
  const profile = getProfile();
  const hash = profileHash(profile);
  const allowedRequests = remainingAiRequests(settings);
  if (allowedRequests <= 0) {
    const msg = `Daily AI limit reached (${settings.ai.dailyLimit} requests). Free scores still work; AI resumes tomorrow or after the cooldown.`;
    if (opts.ids) throw new AppError('AI_QUOTA', msg);
    return { analyzed: 0, error: msg, ids: [] };
  }

  const all = jobsTable().all();
  let targets: JobRow[];
  if (opts.ids) {
    const want = new Set(opts.ids);
    targets = all.filter((r) => want.has(r.id));
    if (!targets.length) throw new AppError('NOT_FOUND', 'Those jobs were not found.');
  } else {
    targets = all.filter((r) => r.aiStatus === 'queued').sort((a, b) => b.score - a.score);
  }
  const batchSize = settings.ai.batchSize;
  targets = targets.slice(0, allowedRequests * batchSize);
  if (!targets.length) return { analyzed: 0, error: '', ids: [] };

  const texts = getTexts(targets.map((t) => t.id));
  enrichThin(targets, texts, profile);

  const results = new Map<string, MatchResult>();
  const attempted = new Set<string>();
  let requests = 0;
  let error = '';
  for (let i = 0; i < targets.length; i += batchSize) {
    if (timeLeft(opts.deadline) < 12_000 && i > 0) break;
    const batch = targets.slice(i, i + batchSize);
    const inputs: AnalysisInput[] = batch.map((r) => {
      const t = texts.get(r.id);
      return {
        id: r.id,
        company: r.company,
        role: r.role,
        location: r.location,
        workMode: r.workMode,
        tags: r.tags ?? [],
        description: t?.description ?? '',
        requirements: t?.requirements ?? '',
      };
    });
    batch.forEach((b) => attempted.add(b.id));
    requests++;
    try {
      const got = analyzeBatch(client, profile, hash, inputs);
      got.forEach((v, k) => results.set(k, v));
    } catch (e) {
      error = errorMessage(e);
      if (e instanceof AppError && (e.code === 'AI_QUOTA' || e.code === 'AI_NOT_CONFIGURED')) break;
    }
  }

  const now = new Date().toISOString();
  withUserLock(() => {
    dropTableCache();
    const t = jobsTable();
    const updates: JobRow[] = [];
    for (const id of attempted) {
      const row = t.get(id);
      if (!row) continue;
      const m = results.get(id);
      if (m) {
        updates.push({ ...row, match: m, score: m.score, aiStatus: 'done', aiError: '', aiAttempts: row.aiAttempts + 1, updatedAt: now });
      } else {
        const attempts = row.aiAttempts + 1;
        updates.push({
          ...row,
          aiStatus: opts.ids ? (row.aiStatus === 'done' ? 'done' : 'failed') : attempts >= 3 ? 'failed' : 'queued',
          aiError: truncate(error || 'The AI reply did not include this job.', 200),
          aiAttempts: attempts,
          updatedAt: now,
        });
      }
    }
    t.update(updates);
  });
  recordUsage(requests, results.size, settings);
  if (results.size) logActivity('', 'ai', `AI analysed ${results.size} job${results.size === 1 ? '' : 's'} with ${client.model}`);
  return { analyzed: results.size, error, ids: Array.from(attempted) };
}

/** SimplifyJobs and similar sources list titles only; fetch fuller text before spending AI on them. */
function enrichThin(targets: JobRow[], texts: Map<string, { id: string; description: string; requirements: string; local: MatchResult | null }>, profile: Profile): void {
  const thin = targets.filter((r) => (texts.get(r.id)?.description ?? '').length < 300 && r.url).slice(0, 15);
  if (!thin.length) return;
  const found = enrichDescriptions(thin.map((r) => ({ id: r.id, url: r.url })));
  if (!found.size) return;
  withUserLock(() => {
    dropTableCache();
    const jt = jobsTable();
    const tt = textTable();
    const rowUpdates: JobRow[] = [];
    const textUpdates: { id: string; description: string; requirements: string; local: MatchResult | null }[] = [];
    found.forEach((f, id) => {
      const row = jt.get(id);
      if (!row) return;
      const location = row.location || f.location;
      const local = scoreLocally(
        { company: row.company, role: row.role, location, workMode: row.workMode, description: f.description, requirements: f.requirements, tags: row.tags ?? [] },
        profile,
      );
      const keepAi = row.match?.method === 'ai';
      rowUpdates.push({ ...row, location, snippet: snippetOf(f.description, f.requirements), match: keepAi ? row.match : local, score: keepAi ? row.score : local.score });
      const text = { id, description: f.description, requirements: f.requirements, local };
      textUpdates.push(text);
      texts.set(id, text);
    });
    jt.update(rowUpdates);
    tt.upsert(textUpdates);
  });
}
