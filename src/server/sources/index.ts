import { SIMPLIFY_CATEGORIES } from '../../shared/defaults';
import { isInternship } from '../../shared/match';
import { collapseWhitespace, normalizeKey, safeHttpUrl, urlHost } from '../../shared/text';
import type { Board, Settings, SourceReport } from '../../shared/types';
import { AppError, errorMessage } from '../errors';
import { log } from '../log';
import { ctx } from '../platform/context';
import { pool } from '../platform/http';
import { httpFetch, httpFetchAll, type HttpRequest, type HttpResponse } from '../runtime';
import type { RawJob } from '../store/jobs';
import {
  boardUrl,
  extractFromHtml,
  parseAtsUrl,
  parseBoard,
  parseGreenhouseSingle,
  parseHn,
  parseLeverSingle,
  parseSimplify,
  parseWwr,
  simplifyUrlCandidates,
  singleJobApiUrl,
  type AtsRef,
} from './parsers';

export interface SourceResult {
  report: SourceReport;
  jobs: RawJob[];
}

function describeHttp(res: HttpResponse): string {
  if (res.error) return res.error.startsWith('Blocked') ? res.error : 'Network error: ' + res.error;
  if (res.status === 404) return 'Not found (404)';
  if (res.status === 429) return 'Rate limited by the source (429)';
  if (res.status >= 500) return `Source is having problems (${res.status})`;
  return `HTTP ${res.status}`;
}

// ---------------------------------------------------------------------------
// Shared cache: public feeds are the same for everyone, so they are fetched at
// most every few hours and reused across users (public.source_cache).

const CACHE_TTL_MS = 3 * 3600_000;
/** Postings older than this never enter the shared SimplifyJobs cache. */
const SIMPLIFY_CACHE_DAYS = 120;

interface CacheEntry {
  jobs: RawJob[];
  fetchedAt: number;
}

async function readCache(keys: string[]): Promise<Map<string, CacheEntry>> {
  const out = new Map<string, CacheEntry>();
  if (!keys.length) return out;
  try {
    const rows = await ctx().service.select('source_cache', { filters: [{ col: 'key', op: 'in', value: keys }] });
    for (const r of rows) {
      const fetchedAt = Date.parse(String(r.fetched_at instanceof Date ? r.fetched_at.toISOString() : r.fetched_at));
      if (Number(r.status) === 200 && Date.now() - fetchedAt < CACHE_TTL_MS && Array.isArray(r.body)) {
        out.set(String(r.key), { jobs: r.body as RawJob[], fetchedAt });
      }
    }
  } catch (e) {
    log.warn('source_cache.read_failed', { message: errorMessage(e) });
  }
  return out;
}

async function writeCache(entries: { key: string; jobs: RawJob[] }[]): Promise<void> {
  const now = new Date().toISOString();
  for (const e of entries) {
    try {
      await ctx().service.upsert('source_cache', [{ key: e.key, fetched_at: now, status: 200, error: '', body: e.jobs }], ['key']);
    } catch (err) {
      log.warn('source_cache.write_failed', { key: e.key, message: errorMessage(err) });
    }
  }
}

/** Fetch a URL, trying fallbacks while the response is not 200. */
async function fetchWithFallbacks(req: HttpRequest, fallbacks: string[]): Promise<HttpResponse> {
  let res = await httpFetch(req);
  for (const fb of fallbacks) {
    if (res.status === 200) break;
    res = await httpFetch({ ...req, url: fb });
  }
  return res;
}

const report = (id: string, label: string): SourceReport => ({ id, label, fetched: 0, relevant: 0, added: 0, error: '', ms: 0 });

async function simplifySource(settings: Settings, now: Date): Promise<SourceResult> {
  const t0 = Date.now();
  const r = report('simplify', 'SimplifyJobs');
  const wanted = settings.sources.simplify.categories.length ? settings.sources.simplify.categories : [...SIMPLIFY_CATEGORIES];
  const keys = wanted.map((c) => `simplify:${c}`);
  const cached = await readCache(keys);
  let jobs: RawJob[];
  if (keys.every((k) => cached.has(k))) {
    jobs = keys.flatMap((k) => cached.get(k)!.jobs);
  } else {
    const [primary, ...fallbacks] = simplifyUrlCandidates(now);
    const res = await fetchWithFallbacks({ url: primary!, timeoutMs: 45_000, maxBytes: 60_000_000 }, fallbacks);
    if (res.status !== 200) {
      r.error = describeHttp(res);
      r.ms = Date.now() - t0;
      return { report: r, jobs: [] };
    }
    let all: RawJob[];
    try {
      all = parseSimplify(res.text, { categories: [], maxAgeDays: SIMPLIFY_CACHE_DAYS, now });
    } catch (e) {
      r.error = errorMessage(e);
      r.ms = Date.now() - t0;
      return { report: r, jobs: [] };
    }
    // The category is the second tag (see parseSimplify); cache each category separately.
    const byCat = new Map<string, RawJob[]>();
    for (const j of all) {
      const cat = j.tags[1] ?? '';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(j);
    }
    await writeCache(SIMPLIFY_CATEGORIES.map((c) => ({ key: `simplify:${c}`, jobs: byCat.get(c) ?? [] })));
    jobs = wanted.flatMap((c) => byCat.get(c) ?? []);
  }
  const cutoff = new Date(now.getTime() - settings.filters.maxAgeDays * 86_400_000).toISOString();
  jobs = jobs.filter((j) => !j.postedAt || j.postedAt >= cutoff).sort((a, b) => (b.postedAt > a.postedAt ? 1 : b.postedAt < a.postedAt ? -1 : 0));
  r.fetched = jobs.length;
  r.ms = Date.now() - t0;
  return { report: r, jobs };
}

async function feedSource(id: string, label: string, url: string, parse: (text: string) => RawJob[]): Promise<SourceResult> {
  const t0 = Date.now();
  const r = report(id, label);
  const cached = (await readCache([id])).get(id);
  if (cached) {
    r.fetched = cached.jobs.length;
    r.ms = Date.now() - t0;
    return { report: r, jobs: cached.jobs };
  }
  const res = await httpFetch({ url });
  let jobs: RawJob[] = [];
  if (res.status !== 200) r.error = describeHttp(res);
  else {
    try {
      jobs = parse(res.text);
      await writeCache([{ key: id, jobs }]);
    } catch (e) {
      r.error = errorMessage(e);
    }
  }
  r.fetched = jobs.length;
  r.ms = Date.now() - t0;
  return { report: r, jobs };
}

async function boardSource(board: Board): Promise<SourceResult> {
  const t0 = Date.now();
  const r = report(`${board.ats}:${board.token}`, board.name || board.token);
  const res = await httpFetch({ url: boardUrl(board), maxBytes: 20_000_000 });
  let jobs: RawJob[] = [];
  if (res.status !== 200) r.error = describeHttp(res);
  else {
    try {
      jobs = parseBoard(res.text, board);
    } catch (e) {
      r.error = errorMessage(e);
    }
  }
  r.fetched = jobs.length;
  r.ms = Date.now() - t0;
  return { report: r, jobs };
}

/** Fetch every enabled source; one failing source never sinks the others. */
export async function fetchSources(settings: Settings, now = new Date()): Promise<SourceResult[]> {
  const s = settings.sources;
  const tasks: (() => Promise<SourceResult>)[] = [];
  if (s.simplify.enabled) tasks.push(() => simplifySource(settings, now));
  for (const board of s.boards) tasks.push(() => boardSource(board));
  if (s.hn.enabled) tasks.push(() => feedSource('hn', 'Hacker News Jobs', 'https://hnrss.org/jobs?count=100', parseHn));
  if (s.wwr.enabled) tasks.push(() => feedSource('wwr', 'We Work Remotely', 'https://weworkremotely.com/categories/remote-programming-jobs.rss', parseWwr));
  return pool(tasks, 6, (t) => t());
}

// ---------------------------------------------------------------------------
// Following a company's job board

function slugCandidates(input: string): string[] {
  const base = normalizeKey(input).replace(/\b(inc|llc|ltd|labs?|ai|technologies|technology|corp)\b/g, ' ').trim();
  const full = normalizeKey(input);
  const variants = [full.replace(/\s+/g, ''), base.replace(/\s+/g, ''), full.replace(/\s+/g, '-'), base.replace(/\s+/g, '-')];
  return Array.from(new Set(variants.filter((v) => /^[a-z0-9][a-z0-9.-]{1,60}$/.test(v)))).slice(0, 3);
}

/**
 * Turn whatever the user typed ("Anthropic", a board URL, "lever:palantir")
 * into a verified board, by probing the ATS APIs in parallel.
 */
export async function resolveBoard(input: string): Promise<{ board: Board; openRoles: number; internRoles: number }> {
  const text = collapseWhitespace(input);
  if (!text) throw new AppError('BAD_INPUT', 'Type a company name or paste its careers page URL.');
  const ref = parseAtsUrl(text);
  const candidates: Board[] = [];
  if (ref) candidates.push({ ats: ref.ats, token: ref.token, name: '' });
  else if (/^https?:\/\//i.test(text)) {
    throw new AppError('BAD_INPUT', 'That URL is not a Greenhouse, Lever or Ashby board. Use "Add from URL" for single postings instead.');
  } else {
    for (const slug of slugCandidates(text)) {
      for (const ats of ['greenhouse', 'lever', 'ashby'] as const) candidates.push({ ats, token: slug, name: text });
    }
  }
  if (!candidates.length) throw new AppError('BAD_INPUT', 'Could not turn that into a board name.');
  const responses = await httpFetchAll(candidates.map((b) => ({ url: boardUrl(b), maxBytes: 20_000_000 })));
  let best: { board: Board; jobs: RawJob[] } | null = null;
  responses.forEach((res, i) => {
    if (res.status !== 200) return;
    try {
      const board = candidates[i]!;
      const jobs = parseBoard(res.text, board);
      if (!best || jobs.length > best.jobs.length) best = { board, jobs };
    } catch {
      /* not this one */
    }
  });
  if (!best) {
    throw new AppError('NOT_FOUND', `No public Greenhouse, Lever or Ashby board found for "${text}". Paste the company's job board URL instead.`);
  }
  const found = best as { board: Board; jobs: RawJob[] };
  const name = found.board.name || prettyCompany(found.jobs[0]?.company || found.board.token);
  const board: Board = { ...found.board, name };
  return {
    board,
    openRoles: found.jobs.length,
    internRoles: found.jobs.filter((j) => isInternship(j.role, j.tags)).length,
  };
}

function prettyCompany(token: string): string {
  return token.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Single postings: "add from URL" and description enrichment

async function fetchAtsSingle(ref: AtsRef): Promise<RawJob | null> {
  const api = singleJobApiUrl(ref);
  if (!api) return null;
  const res = await httpFetch({ url: api });
  if (res.status !== 200) return null;
  const board: Board = { ats: ref.ats, token: ref.token, name: prettyCompany(ref.token) };
  return ref.ats === 'greenhouse' ? parseGreenhouseSingle(res.text, board) : parseLeverSingle(res.text, board);
}

/** Read a single job posting from any URL. ATS APIs first, then structured data on the page. */
export async function readPosting(url: string): Promise<RawJob> {
  const safe = safeHttpUrl(url);
  if (!safe) throw new AppError('BAD_INPUT', 'Enter a full http(s) link to the job posting.');
  const ref = parseAtsUrl(safe);
  if (ref?.jobId) {
    const job = await fetchAtsSingle(ref);
    if (job) return { ...job, source: 'url', url: job.url || safe };
  }
  const res = await httpFetch({ url: safe, headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (res.status !== 200) {
    throw new AppError('FETCH_FAILED', `Could not open that page (${describeHttp(res)}). Add it manually instead.`);
  }
  const page = extractFromHtml(res.text, safe);
  return {
    source: 'url',
    sourceLabel: urlHost(safe).replace(/^www\./, ''),
    sourceRef: '',
    url: safe,
    company: page.company,
    role: page.role,
    location: page.location,
    description: page.description,
    requirements: page.requirements,
    postedAt: page.postedAt,
    deadline: page.deadline,
    deadlineText: '',
    tags: page.structured ? [] : ['unstructured'],
  };
}

/**
 * Fetch fuller descriptions for postings that arrived without one (SimplifyJobs
 * only lists titles). Runs in parallel; failures are silently skipped.
 */
export async function enrichDescriptions(items: { id: string; url: string }[]): Promise<Map<string, { description: string; requirements: string; location: string }>> {
  const out = new Map<string, { description: string; requirements: string; location: string }>();
  const plans = items
    .map((it) => {
      const ref = parseAtsUrl(it.url);
      const api = ref?.jobId ? singleJobApiUrl(ref) : '';
      return { it, ref, req: { url: api || it.url, headers: api ? {} : { Accept: 'text/html' }, timeoutMs: 12_000 } as HttpRequest, api: Boolean(api) };
    })
    .filter((p) => safeHttpUrl(p.req.url));
  const responses = await httpFetchAll(plans.map((p) => p.req));
  responses.forEach((res, i) => {
    const plan = plans[i]!;
    if (res.status !== 200 || !res.text) return;
    try {
      if (plan.api && plan.ref) {
        const board: Board = { ats: plan.ref.ats, token: plan.ref.token, name: plan.ref.token };
        const job = plan.ref.ats === 'greenhouse' ? parseGreenhouseSingle(res.text, board) : parseLeverSingle(res.text, board);
        if (job?.description) out.set(plan.it.id, { description: job.description, requirements: job.requirements, location: job.location });
      } else {
        const page = extractFromHtml(res.text, plan.it.url);
        if (page.structured || page.description.length > 400) {
          out.set(plan.it.id, { description: page.description, requirements: page.requirements, location: page.location });
        }
      }
    } catch {
      /* skip */
    }
  });
  return out;
}
