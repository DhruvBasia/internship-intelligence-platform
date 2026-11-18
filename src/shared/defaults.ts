import type { AiProvider, Board, Degree, DeepPartial, Profile, Settings, WorkMode } from './types';
import { DEGREES, WORK_MODES } from './types';
import { canonicalSkill } from './skills';
import { clamp, collapseWhitespace, safeHttpUrl, splitList } from './text';

export const APP_VERSION = '3.0.0';
export const APP_NAME = 'InternIQ';

/** SimplifyJobs categories as they appear in listings.json. */
export const SIMPLIFY_CATEGORIES = ['AI/ML/Data', 'Software', 'Quant', 'Hardware', 'Product'] as const;

export const LIMITS = {
  resumeChars: 20_000,
  descriptionChars: 12_000,
  requirementsChars: 6_000,
  notesChars: 10_000,
  coverLetterChars: 12_000,
  shortText: 200,
  maxBoards: 40,
  maxJobsPerBulk: 500,
  tsvChars: 500_000,
} as const;

export const DEFAULT_PROFILE: Profile = {
  name: '',
  school: '',
  degree: '',
  gradYear: null,
  skills: [],
  targetRoles: [],
  locations: [],
  workModes: [],
  needsSponsorship: false,
  resumeText: '',
  links: { github: '', linkedin: '', portfolio: '' },
};

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    provider: 'none',
    model: '',
    baseUrl: '',
    dailyLimit: 20,
    batchSize: 5,
    autoMinScore: 60,
    autoAnalyze: true,
  },
  sources: {
    simplify: { enabled: true, categories: ['AI/ML/Data', 'Software'] },
    hn: { enabled: false },
    wwr: { enabled: false },
    boards: [],
  },
  filters: {
    internshipsOnly: true,
    includeKeywords: [],
    excludeKeywords: ['senior', 'staff', 'principal', 'director'],
    maxAgeDays: 60,
    maxNewPerRefresh: 150,
  },
  automation: {
    enabled: false,
    hour: 8,
    timezone: 'Asia/Kolkata',
    digest: true,
    digestThreshold: 75,
  },
  mail: {
    enabled: true,
    autoTrack: true,
    lookbackDays: 45,
    extraSenders: [],
  },
  onboarded: false,
};

/** Known-good OpenAI-compatible endpoints with free tiers. The user brings their own key. */
export const OPENAI_COMPAT_PRESETS = [
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
] as const;

const str = (v: unknown, max: number = LIMITS.shortText) => collapseWhitespace(String(v ?? '')).slice(0, max);

export function normalizeProfile(input: Partial<Profile> | null | undefined): Profile {
  const p = input ?? {};
  const degree = (DEGREES as readonly string[]).includes(String(p.degree)) ? (p.degree as Degree) : '';
  const year = Number(p.gradYear);
  const links = (p.links ?? {}) as Partial<Profile['links']>;
  return {
    name: str(p.name, 120),
    school: str(p.school, 160),
    degree,
    gradYear: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null,
    skills: splitList(p.skills, 80).map(canonicalSkill).filter(Boolean),
    targetRoles: splitList(p.targetRoles, 20),
    locations: splitList(p.locations, 20),
    workModes: (Array.isArray(p.workModes) ? p.workModes : []).filter((m): m is WorkMode =>
      (WORK_MODES as readonly string[]).includes(m) && m !== 'unknown',
    ),
    needsSponsorship: Boolean(p.needsSponsorship),
    resumeText: String(p.resumeText ?? '').replace(/\r\n/g, '\n').slice(0, LIMITS.resumeChars),
    links: {
      github: safeHttpUrl(links.github),
      linkedin: safeHttpUrl(links.linkedin),
      portfolio: safeHttpUrl(links.portfolio),
    },
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(clamp(n, lo, hi)) : fallback;
}

function normalizeBoards(input: unknown, fallback: Board[]): Board[] {
  if (!Array.isArray(input)) return fallback;
  const seen = new Set<string>();
  const out: Board[] = [];
  for (const b of input as Partial<Board>[]) {
    if (!b || !['greenhouse', 'lever', 'ashby'].includes(String(b.ats))) continue;
    const token = String(b.token ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(token)) continue;
    const key = b.ats + ':' + token;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ats: b.ats as Board['ats'], token, name: str(b.name, 80) || token });
    if (out.length >= LIMITS.maxBoards) break;
  }
  return out;
}

function validTimezone(tz: unknown, fallback: string): string {
  const s = String(tz ?? '');
  return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(s) || s === 'UTC' ? s : fallback;
}

/** Apply a client patch on top of the current settings, validating every field. */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings> | null | undefined): Settings {
  const p = patch ?? {};
  const ai = p.ai ?? {};
  const src = p.sources ?? {};
  const f = p.filters ?? {};
  const auto = p.automation ?? {};
  const mail = p.mail ?? {};
  const provider: AiProvider = ['gemini', 'openai_compat', 'none'].includes(String(ai.provider))
    ? (ai.provider as AiProvider)
    : base.ai.provider;
  const baseUrl = ai.baseUrl === undefined ? base.ai.baseUrl : safeHttpUrl(ai.baseUrl).replace(/\/+$/, '');
  const categories = Array.isArray(src.simplify?.categories)
    ? src.simplify!.categories!.filter((c) => (SIMPLIFY_CATEGORIES as readonly string[]).includes(String(c)))
    : base.sources.simplify.categories;
  return {
    ai: {
      provider,
      model: ai.model === undefined ? base.ai.model : str(ai.model, 120).replace(/[^A-Za-z0-9._:/@-]/g, ''),
      baseUrl,
      dailyLimit: num(ai.dailyLimit, base.ai.dailyLimit, 0, 2000),
      batchSize: num(ai.batchSize, base.ai.batchSize, 1, 10),
      autoMinScore: num(ai.autoMinScore, base.ai.autoMinScore, 0, 100),
      autoAnalyze: bool(ai.autoAnalyze, base.ai.autoAnalyze),
    },
    sources: {
      simplify: {
        enabled: bool(src.simplify?.enabled, base.sources.simplify.enabled),
        categories: categories as string[],
      },
      hn: { enabled: bool(src.hn?.enabled, base.sources.hn.enabled) },
      wwr: { enabled: bool(src.wwr?.enabled, base.sources.wwr.enabled) },
      boards: normalizeBoards(src.boards, base.sources.boards),
    },
    filters: {
      internshipsOnly: bool(f.internshipsOnly, base.filters.internshipsOnly),
      includeKeywords: f.includeKeywords === undefined ? base.filters.includeKeywords : splitList(f.includeKeywords, 30),
      excludeKeywords: f.excludeKeywords === undefined ? base.filters.excludeKeywords : splitList(f.excludeKeywords, 30),
      maxAgeDays: num(f.maxAgeDays, base.filters.maxAgeDays, 1, 365),
      maxNewPerRefresh: num(f.maxNewPerRefresh, base.filters.maxNewPerRefresh, 10, 500),
    },
    automation: {
      enabled: bool(auto.enabled, base.automation.enabled),
      hour: num(auto.hour, base.automation.hour, 0, 23),
      timezone: validTimezone(auto.timezone, base.automation.timezone),
      digest: bool(auto.digest, base.automation.digest),
      digestThreshold: num(auto.digestThreshold, base.automation.digestThreshold, 0, 100),
    },
    mail: {
      enabled: bool(mail.enabled, base.mail.enabled),
      autoTrack: bool(mail.autoTrack, base.mail.autoTrack),
      lookbackDays: num(mail.lookbackDays, base.mail.lookbackDays, 1, 180),
      extraSenders:
        mail.extraSenders === undefined
          ? base.mail.extraSenders
          : splitList(mail.extraSenders, 30).filter((s) => /^[a-z0-9._%+@-]+\.[a-z]{2,}$/i.test(s)).map((s) => s.toLowerCase()),
    },
    onboarded: bool(p.onboarded, base.onboarded),
  };
}
