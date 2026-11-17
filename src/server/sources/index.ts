import { isInternship } from '../../shared/match';
import { collapseWhitespace, normalizeKey, safeHttpUrl, urlHost } from '../../shared/text';
import type { Board, Settings, SourceReport } from '../../shared/types';
import { AppError } from '../errors';
import { httpFetch, httpFetchAll, type HttpRequest, type HttpResponse } from '../gas';
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

interface SourceTask {
  id: string;
  label: string;
  request: HttpRequest;
  fallbacks: string[];
  parse(res: HttpResponse): RawJob[];
}

export interface SourceResult {
  report: SourceReport;
  jobs: RawJob[];
}

function describeHttp(res: HttpResponse): string {
  if (res.error) return 'Network error: ' + res.error;
  if (res.status === 404) return 'Not found (404)';
  if (res.status === 429) return 'Rate limited by the source (429)';
  if (res.status >= 500) return `Source is having problems (${res.status})`;
  return `HTTP ${res.status}`;
}

export function buildTasks(settings: Settings, now: Date): SourceTask[] {
  const tasks: SourceTask[] = [];
  const s = settings.sources;
  if (s.simplify.enabled) {
    const [primary, ...fallbacks] = simplifyUrlCandidates(now);
    tasks.push({
      id: 'simplify',
      label: 'SimplifyJobs',
      request: { url: primary! },
      fallbacks,
      parse: (res) => parseSimplify(res.text, { categories: s.simplify.categories, maxAgeDays: settings.filters.maxAgeDays, now }),
    });
  }
  for (const board of s.boards) {
    tasks.push({
      id: `${board.ats}:${board.token}`,
      label: board.name || board.token,
      request: { url: boardUrl(board) },
      fallbacks: [],
      parse: (res) => parseBoard(res.text, board),
    });
  }
  if (s.hn.enabled) {
    tasks.push({ id: 'hn', label: 'Hacker News Jobs', request: { url: 'https://hnrss.org/jobs?count=100' }, fallbacks: [], parse: (r) => parseHn(r.text) });
  }
  if (s.wwr.enabled) {
    tasks.push({
      id: 'wwr',
      label: 'We Work Remotely',
      request: { url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
      fallbacks: [],
      parse: (r) => parseWwr(r.text),
    });
  }
  return tasks;
}

/** Fetch every enabled source in parallel; one failing source never sinks the others. */
export function fetchSources(settings: Settings, now = new Date()): SourceResult[] {
  const tasks = buildTasks(settings, now);
  const started = Date.now();
  const responses = httpFetchAll(tasks.map((t) => t.request));
  const fetchMs = Date.now() - started;
  return tasks.map((task, i) => {
    const t0 = Date.now();
    let res = responses[i]!;
    for (const fb of task.fallbacks) {
      if (res.status === 200) break;
      res = httpFetch({ ...task.request, url: fb });
    }
    const report: SourceReport = { id: task.id, label: task.label, fetched: 0, relevant: 0, added: 0, error: '', ms: 0 };
    let jobs: RawJob[] = [];
    if (res.status !== 200) {
      report.error = describeHttp(res);
    } else {
      try {
        jobs = task.parse(res);
        report.fetched = jobs.length;
      } catch (e) {
        report.error = e instanceof Error ? e.message : String(e);
      }
    }
    report.ms = fetchMs + (Date.now() - t0);
    return { report, jobs };
  });
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
export function resolveBoard(input: string): { board: Board; openRoles: number; internRoles: number } {
  const text = collapseWhitespace(input);
  if (!text) throw new AppError('BAD_INPUT', 'Type a company name or paste its careers page URL.');
  const ref = parseAtsUrl(text);
  const candidates: Board[] = [];
  if (ref) candidates.push({ ats: ref.ats, token: ref.token, name: '' });
  else if (/^https?:\/\//i.test(text)) {
    throw new AppError(
      'BAD_INPUT',
      'That URL is not a Greenhouse, Lever or Ashby board. Use "Add from URL" for single postings instead.',
    );
  } else {
    for (const slug of slugCandidates(text)) {
      for (const ats of ['greenhouse', 'lever', 'ashby'] as const) candidates.push({ ats, token: slug, name: text });
    }
  }
  if (!candidates.length) throw new AppError('BAD_INPUT', 'Could not turn that into a board name.');
  const responses = httpFetchAll(candidates.map((b) => ({ url: boardUrl(b) })));
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
    throw new AppError(
      'NOT_FOUND',
      `No public Greenhouse, Lever or Ashby board found for "${text}". Paste the company's job board URL instead.`,
    );
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

function fetchAtsSingle(ref: AtsRef): RawJob | null {
  const api = singleJobApiUrl(ref);
  if (!api) return null;
  const res = httpFetch({ url: api });
  if (res.status !== 200) return null;
  const board: Board = { ats: ref.ats, token: ref.token, name: prettyCompany(ref.token) };
  return ref.ats === 'greenhouse' ? parseGreenhouseSingle(res.text, board) : parseLeverSingle(res.text, board);
}

/** Read a single job posting from any URL. ATS APIs first, then structured data on the page. */
export function readPosting(url: string): RawJob {
  const safe = safeHttpUrl(url);
  if (!safe) throw new AppError('BAD_INPUT', 'Enter a full http(s) link to the job posting.');
  const ref = parseAtsUrl(safe);
  if (ref?.jobId) {
    const job = fetchAtsSingle(ref);
    if (job) return { ...job, source: 'url', url: job.url || safe };
  }
  const res = httpFetch({ url: safe, headers: { Accept: 'text/html,application/xhtml+xml' } });
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
export function enrichDescriptions(items: { id: string; url: string }[]): Map<string, { description: string; requirements: string; location: string }> {
  const out = new Map<string, { description: string; requirements: string; location: string }>();
  const plans = items
    .map((it) => {
      const ref = parseAtsUrl(it.url);
      const api = ref?.jobId ? singleJobApiUrl(ref) : '';
      return { it, ref, req: { url: api || it.url, headers: api ? {} : { Accept: 'text/html' } } as HttpRequest, api: Boolean(api) };
    })
    .filter((p) => safeHttpUrl(p.req.url));
  const responses = httpFetchAll(plans.map((p) => p.req));
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
