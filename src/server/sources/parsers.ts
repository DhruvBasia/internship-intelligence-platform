/**
 * Pure parsers for every job source. No Apps Script APIs here, so each one is
 * unit-tested against recorded payloads.
 */
import type { Board } from '../../shared/types';
import { collapseWhitespace, decodeEntities, htmlToText, safeHttpUrl, toIsoDate, truncate, urlHost } from '../../shared/text';
import type { RawJob } from '../store/jobs';

const DESC_MAX = 12_000;

function raw(partial: Partial<RawJob> & Pick<RawJob, 'source' | 'sourceLabel' | 'company' | 'role' | 'url'>): RawJob {
  return {
    sourceRef: '',
    location: '',
    description: '',
    requirements: '',
    postedAt: '',
    deadline: '',
    deadlineText: '',
    tags: [],
    ...partial,
  };
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SimplifyJobs (community-maintained internship list, updated daily)

interface SimplifyItem {
  id?: string;
  company_name?: string;
  title?: string;
  url?: string;
  locations?: string[] | string;
  category?: string;
  terms?: string[];
  degrees?: string[];
  sponsorship?: string;
  active?: boolean;
  is_visible?: boolean;
  date_posted?: number;
}

const SIMPLIFY_CATEGORY_ALIASES: Record<string, string> = {
  'software engineering': 'Software',
  software: 'Software',
  'data science, ai & machine learning': 'AI/ML/Data',
  'ai/ml/data': 'AI/ML/Data',
  'product management': 'Product',
  product: 'Product',
  quant: 'Quant',
  'quantitative finance': 'Quant',
  hardware: 'Hardware',
  'hardware engineering': 'Hardware',
};

export function simplifyCategory(raw: string | undefined): string {
  return SIMPLIFY_CATEGORY_ALIASES[String(raw ?? '').toLowerCase().trim()] ?? String(raw ?? '');
}

export function simplifyUrlCandidates(now: Date): string[] {
  // The repo is renamed each cycle (old names redirect). After June, next summer's list is live.
  const year = now.getUTCFullYear() + (now.getUTCMonth() >= 5 ? 1 : 0);
  return [year, year - 1].map(
    (y) => `https://raw.githubusercontent.com/SimplifyJobs/Summer${y}-Internships/dev/.github/scripts/listings.json`,
  );
}

export function parseSimplify(
  text: string,
  opts: { categories: string[]; maxAgeDays: number; now: Date },
): RawJob[] {
  const list = safeJson<SimplifyItem[]>(text);
  if (!Array.isArray(list)) throw new Error('SimplifyJobs returned an unexpected format');
  const cutoff = opts.now.getTime() / 1000 - opts.maxAgeDays * 86_400;
  const wanted = new Set(opts.categories);
  const out: RawJob[] = [];
  for (const item of list) {
    if (item.active === false || item.is_visible === false) continue;
    if (typeof item.date_posted === 'number' && item.date_posted < cutoff) continue;
    const category = simplifyCategory(item.category);
    if (wanted.size && !wanted.has(category)) continue;
    const url = safeHttpUrl(item.url);
    if (!url || !item.company_name || !item.title) continue;
    const locations = Array.isArray(item.locations) ? item.locations : item.locations ? [item.locations] : [];
    const terms = Array.isArray(item.terms) ? item.terms.filter((t) => t && t !== 'N/A') : [];
    const degrees = Array.isArray(item.degrees) ? item.degrees : [];
    const sponsorship = item.sponsorship && item.sponsorship !== 'Other' ? [item.sponsorship] : [];
    out.push(
      raw({
        source: 'simplify',
        sourceLabel: 'SimplifyJobs',
        sourceRef: String(item.id ?? ''),
        company: collapseWhitespace(item.company_name),
        role: collapseWhitespace(item.title),
        url,
        location: locations.join('; '),
        postedAt: toIsoDate(item.date_posted),
        tags: ['internship', category, ...terms, ...degrees, ...sponsorship].filter(Boolean),
      }),
    );
  }
  // Newest first so per-refresh caps keep the freshest postings.
  return out.sort((a, b) => (b.postedAt > a.postedAt ? 1 : b.postedAt < a.postedAt ? -1 : 0));
}

// ---------------------------------------------------------------------------
// Company job boards (public, keyless JSON APIs)

export function boardUrl(board: Board): string {
  const t = encodeURIComponent(board.token);
  switch (board.ats) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${t}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  }
}

interface GreenhouseJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
  company_name?: string;
  application_deadline?: string | null;
  metadata?: { name?: string; value?: unknown }[] | null;
  departments?: { name?: string }[];
}

function greenhouseJob(j: GreenhouseJob, board: Board): RawJob | null {
  const url = safeHttpUrl(j.absolute_url);
  if (!url || !j.title) return null;
  const locType = (j.metadata ?? []).find((m) => /location type|workplace|remote/i.test(String(m?.name)));
  const dept = (j.departments ?? []).map((d) => d?.name).filter(Boolean) as string[];
  return raw({
    source: 'greenhouse',
    sourceLabel: board.name || j.company_name || board.token,
    sourceRef: String(j.id ?? ''),
    company: j.company_name || board.name || board.token,
    role: collapseWhitespace(j.title),
    url,
    location: collapseWhitespace([j.location?.name, locType?.value ? String(locType.value) : ''].filter(Boolean).join(' · ')),
    description: truncate(htmlToText(j.content ?? ''), DESC_MAX),
    postedAt: toIsoDate(j.first_published || j.updated_at),
    deadline: toIsoDate(j.application_deadline).slice(0, 10),
    tags: dept.slice(0, 3),
  });
}

export function parseGreenhouse(text: string, board: Board): RawJob[] {
  const data = safeJson<{ jobs?: GreenhouseJob[] }>(text);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Greenhouse board not found');
  return data.jobs.map((j) => greenhouseJob(j, board)).filter((j): j is RawJob => j !== null);
}

export function parseGreenhouseSingle(text: string, board: Board): RawJob | null {
  const j = safeJson<GreenhouseJob>(text);
  return j ? greenhouseJob(j, board) : null;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  descriptionPlain?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
  createdAt?: number;
  workplaceType?: string;
}

function leverPosting(p: LeverPosting, board: Board): RawJob | null {
  const url = safeHttpUrl(p.hostedUrl);
  if (!url || !p.text) return null;
  const lists = (p.lists ?? []).map((l) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`).join('\n\n');
  const commitment = p.categories?.commitment ?? '';
  const isIntern = /intern|co-?op|student|trainee/i.test(commitment);
  const workplace = p.workplaceType && p.workplaceType !== 'unspecified' ? p.workplaceType : '';
  return raw({
    source: 'lever',
    sourceLabel: board.name || board.token,
    sourceRef: String(p.id ?? ''),
    company: board.name || board.token,
    role: collapseWhitespace(p.text),
    url,
    location: collapseWhitespace([p.categories?.allLocations?.join('; ') || p.categories?.location, workplace].filter(Boolean).join(' · ')),
    description: truncate(p.descriptionPlain || htmlToText(p.description ?? ''), DESC_MAX),
    requirements: truncate(lists + (p.additionalPlain ? '\n\n' + p.additionalPlain : ''), 6000),
    postedAt: toIsoDate(p.createdAt),
    tags: [isIntern ? 'internship' : '', commitment, p.categories?.team ?? ''].filter(Boolean),
  });
}

export function parseLever(text: string, board: Board): RawJob[] {
  const data = safeJson<LeverPosting[] | { ok?: boolean }>(text);
  if (!Array.isArray(data)) throw new Error('Lever board not found');
  return data.map((p) => leverPosting(p, board)).filter((j): j is RawJob => j !== null);
}

export function parseLeverSingle(text: string, board: Board): RawJob | null {
  const p = safeJson<LeverPosting>(text);
  return p && !Array.isArray(p) ? leverPosting(p, board) : null;
}

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  isListed?: boolean;
}

export function parseAshby(text: string, board: Board): RawJob[] {
  const data = safeJson<{ jobs?: AshbyJob[] }>(text);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Ashby board not found');
  const out: RawJob[] = [];
  for (const j of data.jobs) {
    if (j.isListed === false) continue;
    const url = safeHttpUrl(j.jobUrl);
    if (!url || !j.title) continue;
    const locs = [j.location, ...(j.secondaryLocations ?? []).map((s) => s?.location)].filter(Boolean);
    const isIntern = /intern/i.test(j.employmentType ?? '');
    out.push(
      raw({
        source: 'ashby',
        sourceLabel: board.name || board.token,
        sourceRef: String(j.id ?? ''),
        company: board.name || board.token,
        role: collapseWhitespace(j.title),
        url,
        location: collapseWhitespace([locs.join('; '), j.isRemote ? 'Remote' : j.workplaceType ?? ''].filter(Boolean).join(' · ')),
        description: truncate(j.descriptionPlain || htmlToText(j.descriptionHtml ?? ''), DESC_MAX),
        postedAt: toIsoDate(j.publishedAt),
        tags: [isIntern ? 'internship' : '', j.department ?? '', j.team ?? ''].filter(Boolean),
      }),
    );
  }
  return out;
}

export function parseBoard(text: string, board: Board): RawJob[] {
  if (board.ats === 'greenhouse') return parseGreenhouse(text, board);
  if (board.ats === 'lever') return parseLever(text, board);
  return parseAshby(text, board);
}

// ---------------------------------------------------------------------------
// RSS feeds (regex-based: tolerant of the malformed XML real feeds contain)

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  fields: Record<string, string>;
}

function rssField(item: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
  if (!m) return '';
  let v = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  if (cdata) v = cdata[1]!;
  else v = decodeEntities(v);
  return v.trim();
}

export function parseRss(xml: string): RssItem[] {
  if (!/<rss|<feed|<channel/i.test(xml)) throw new Error('Feed did not return RSS');
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => ({
    title: collapseWhitespace(htmlToText(rssField(item, 'title'))),
    link: rssField(item, 'link'),
    description: rssField(item, 'description'),
    pubDate: rssField(item, 'pubDate'),
    fields: { region: rssField(item, 'region'), category: rssField(item, 'category') },
  }));
}

/** "Acme (YC W24) Is Hiring a Machine Learning Intern in SF" → company + role. */
export function splitHnTitle(title: string): { company: string; role: string; location: string } {
  const m = /^(.+?)(?:\s*\((?:YC|S|W|F|P|X)[^)]*\))?\s+(?:is|are)\s+hiring\s*(?:an?\s+|for\s+)?(.*)$/i.exec(title);
  if (!m) return { company: title.split(/[–—:|-]/)[0]!.trim(), role: title, location: '' };
  const company = m[1]!.replace(/\s*\([^)]*\)\s*$/, '').trim();
  let role = (m[2] || 'Multiple roles').trim();
  let location = '';
  const loc = /\s+(?:in|\()\s*([A-Z][\w .,'/-]+?)\)?$/.exec(role);
  if (loc) {
    location = loc[1]!.trim();
    role = role.slice(0, loc.index).trim();
  }
  if (/\bremote\b/i.test(role) && !location) location = 'Remote';
  return { company, role: role.replace(/[.!]+$/, ''), location };
}

export function parseHn(xml: string): RawJob[] {
  return parseRss(xml)
    .map((it) => {
      const { company, role, location } = splitHnTitle(it.title);
      const url = safeHttpUrl(it.link);
      if (!url) return null;
      return raw({
        source: 'hn',
        sourceLabel: 'Hacker News Jobs',
        company,
        role,
        url,
        location,
        description: it.title,
        postedAt: toIsoDate(it.pubDate),
      });
    })
    .filter((j): j is RawJob => j !== null);
}

export function parseWwr(xml: string): RawJob[] {
  return parseRss(xml)
    .map((it) => {
      const idx = it.title.indexOf(':');
      const company = idx > 0 ? it.title.slice(0, idx).trim() : 'Unknown company';
      const role = idx > 0 ? it.title.slice(idx + 1).trim() : it.title;
      const url = safeHttpUrl(it.link);
      if (!url) return null;
      return raw({
        source: 'wwr',
        sourceLabel: 'We Work Remotely',
        company,
        role,
        url,
        location: ['Remote', it.fields.region].filter(Boolean).join(' · '),
        description: truncate(htmlToText(it.description), DESC_MAX),
        postedAt: toIsoDate(it.pubDate),
        tags: [it.fields.category ?? ''].filter(Boolean),
      });
    })
    .filter((j): j is RawJob => j !== null);
}

// ---------------------------------------------------------------------------
// ATS URL recognition (for "follow a company" and for single job pages)

export interface AtsRef {
  ats: Board['ats'];
  token: string;
  jobId: string;
}

export function parseAtsUrl(input: string): AtsRef | null {
  const s = input.trim();
  const short = /^(greenhouse|lever|ashby):([a-z0-9._-]+)$/i.exec(s);
  if (short) return { ats: short[1]!.toLowerCase() as Board['ats'], token: short[2]!.toLowerCase(), jobId: '' };
  if (!/^https?:\/\//i.test(s)) return null;
  const host = urlHost(s);
  const path = s.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  const query = s.includes('?') ? s.slice(s.indexOf('?') + 1) : '';
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const forParam = /(?:^|&)for=([a-z0-9._-]+)/i.exec(query);
    if (forParam) {
      const jid = /(?:^|&)token=(\d+)/i.exec(query);
      return { ats: 'greenhouse', token: forParam[1]!.toLowerCase(), jobId: jid ? jid[1]! : '' };
    }
    if (parts[0] === 'embed') return null;
    if (parts[0]) return { ats: 'greenhouse', token: parts[0].toLowerCase(), jobId: parts[1] === 'jobs' && parts[2] ? parts[2] : '' };
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (parts[0]) return { ats: 'lever', token: parts[0].toLowerCase(), jobId: parts[1] && /^[0-9a-f-]{20,}$/i.test(parts[1]) ? parts[1] : '' };
  }
  if (host === 'jobs.ashbyhq.com') {
    if (parts[0]) return { ats: 'ashby', token: decodeURIComponent(parts[0]).toLowerCase(), jobId: parts[1] && /^[0-9a-f-]{20,}$/i.test(parts[1]) ? parts[1] : '' };
  }
  return null;
}

export function singleJobApiUrl(ref: AtsRef): string {
  if (!ref.jobId) return '';
  if (ref.ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs/${encodeURIComponent(ref.jobId)}`;
  if (ref.ats === 'lever') return `https://api.lever.co/v0/postings/${encodeURIComponent(ref.token)}/${encodeURIComponent(ref.jobId)}`;
  return '';
}

// ---------------------------------------------------------------------------
// Generic job pages: JSON-LD JobPosting first, then OpenGraph/meta/title.

interface JsonLdPosting {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: string | { name?: string };
  jobLocation?: unknown;
  jobLocationType?: string;
  datePosted?: string;
  validThrough?: string;
  qualifications?: string;
  skills?: string;
  responsibilities?: string;
  experienceRequirements?: string | { description?: string };
  employmentType?: string | string[];
}

function findJobPosting(node: unknown, depth = 0): JsonLdPosting | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj as JsonLdPosting;
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    if (obj[key]) {
      const hit = findJobPosting(obj[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function locationFromLd(loc: unknown): string {
  const list = Array.isArray(loc) ? loc : [loc];
  const names = list
    .map((l) => {
      if (!l || typeof l !== 'object') return typeof l === 'string' ? l : '';
      const addr = (l as { address?: unknown }).address;
      if (typeof addr === 'string') return addr;
      if (addr && typeof addr === 'object') {
        const a = addr as Record<string, unknown>;
        const country = typeof a.addressCountry === 'object' ? (a.addressCountry as { name?: string })?.name : a.addressCountry;
        return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ');
      }
      return '';
    })
    .filter(Boolean);
  return names.join('; ');
}

export function metaContent(html: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:name|property)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = a ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${esc}["']`, 'i').exec(html);
  return b ? decodeEntities(b[1]!).trim() : '';
}

/** Split "Role - Company" / "Role at Company" / "Company | Role" page titles. */
export function splitPageTitle(title: string): { role: string; company: string } {
  const t = collapseWhitespace(title);
  const at = /^(.+?)\s+at\s+(.+?)(?:\s*[|–—-]\s*.*)?$/i.exec(t);
  if (at) return { role: at[1]!.trim(), company: at[2]!.trim() };
  const parts = t.split(/\s+[|–—-]\s+/);
  if (parts.length >= 2) {
    const roleish = /(intern|engineer|developer|scientist|analyst|research|fellow|designer|manager|associate)/i;
    if (roleish.test(parts[0]!)) return { role: parts[0]!.trim(), company: parts[1]!.trim() };
    if (roleish.test(parts[1]!)) return { role: parts[1]!.trim(), company: parts[0]!.trim() };
    return { role: parts[0]!.trim(), company: parts[parts.length - 1]!.trim() };
  }
  return { role: t, company: '' };
}

export interface PageExtract {
  company: string;
  role: string;
  location: string;
  description: string;
  requirements: string;
  postedAt: string;
  deadline: string;
  structured: boolean;
}

export function extractFromHtml(html: string, url: string): PageExtract {
  const out: PageExtract = { company: '', role: '', location: '', description: '', requirements: '', postedAt: '', deadline: '', structured: false };
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of scripts) {
    const json = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    const posting = findJobPosting(safeJson<unknown>(json));
    if (!posting) continue;
    out.structured = true;
    out.role = collapseWhitespace(htmlToText(posting.title ?? ''));
    const org = posting.hiringOrganization;
    out.company = collapseWhitespace(typeof org === 'string' ? org : org?.name ?? '');
    out.location = locationFromLd(posting.jobLocation) || (posting.jobLocationType === 'TELECOMMUTE' ? 'Remote' : '');
    if (posting.jobLocationType === 'TELECOMMUTE' && out.location !== 'Remote') out.location += ' · Remote';
    out.description = truncate(htmlToText(posting.description ?? ''), DESC_MAX);
    const exp = typeof posting.experienceRequirements === 'object' ? posting.experienceRequirements?.description : posting.experienceRequirements;
    out.requirements = truncate(
      [posting.qualifications, posting.skills, exp].filter(Boolean).map((s) => htmlToText(String(s))).join('\n\n'),
      6000,
    );
    out.postedAt = toIsoDate(posting.datePosted);
    out.deadline = toIsoDate(posting.validThrough).slice(0, 10);
    break;
  }
  if (!out.role) {
    const og = metaContent(html, 'og:title') || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
    const split = splitPageTitle(decodeEntities(og));
    out.role = split.role;
    if (!out.company) out.company = split.company;
  }
  if (!out.company) out.company = metaContent(html, 'og:site_name');
  if (!out.company) {
    const host = urlHost(url).replace(/^(www|jobs|careers|boards|apply)\./, '');
    out.company = host.split('.')[0] ? host.split('.')[0]!.replace(/^./, (c) => c.toUpperCase()) : '';
  }
  if (!out.description) {
    const metaDesc = metaContent(html, 'og:description') || metaContent(html, 'description');
    const body = htmlToText(
      html
        .replace(/<(header|footer|nav|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/^[\s\S]*?<body[^>]*>/i, ''),
    );
    out.description = truncate(body.length > 400 ? body : metaDesc || body, 6000);
  }
  return out;
}
