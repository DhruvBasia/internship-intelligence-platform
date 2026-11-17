import { batch, computed, signal } from '@preact/signals';
import type {
  ActivityEntry,
  BootstrapData,
  DeepPartial,
  JobPatch,
  JobSummary,
  Profile,
  RefreshReport,
  Settings,
  SettingsView,
  Stage,
  UsageView,
} from '../shared/types';
import { call, errorText } from './api';
import { plural } from './lib/format';

export type View = 'home' | 'discover' | 'pipeline' | 'insights' | 'settings';

// ---------------------------------------------------------------------------
// Core state

export const bootError = signal('');
export const loaded = signal(false);
export const version = signal('');
export const email = signal('');
export const sheetUrl = signal('');
export const profile = signal<Profile | null>(null);
export const settings = signal<SettingsView | null>(null);
export const usage = signal<UsageView | null>(null);
export const activity = signal<ActivityEntry[]>([]);
export const lastRefresh = signal<RefreshReport | null>(null);
export const migratedFromV1 = signal(0);
export const jobsById = signal<Map<string, JobSummary>>(new Map());
export const jobs = computed(() => Array.from(jobsById.value.values()));

// ---------------------------------------------------------------------------
// UI state

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('iip.' + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem('iip.' + key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

export const view = signal<View>(stored<View>('view', 'home'));
export const openJobId = signal<string | null>(null);
export const addOpen = signal<null | 'url' | 'manual' | 'import'>(null);
export const refreshing = signal(false);
export const theme = signal<'system' | 'light' | 'dark'>(stored('theme', 'system'));

export interface DiscoverFilters {
  q: string;
  stages: Stage[];
  minScore: number;
  source: string;
  workMode: string;
  sort: 'score' | 'newest' | 'deadline';
  starredOnly: boolean;
  aiOnly: boolean;
}
export const DEFAULT_FILTERS: DiscoverFilters = {
  q: '',
  stages: ['discovered', 'saved'],
  minScore: 0,
  source: '',
  workMode: '',
  sort: 'score',
  starredOnly: false,
  aiOnly: false,
};
export const filters = signal<DiscoverFilters>({ ...DEFAULT_FILTERS, ...stored<Partial<DiscoverFilters>>('filters', {}), q: '' });

export function navigate(v: View): void {
  view.value = v;
  remember('view', v);
  window.scrollTo({ top: 0 });
}

export function setFilters(patch: Partial<DiscoverFilters>): void {
  filters.value = { ...filters.value, ...patch };
  const { q: _q, ...persist } = filters.value;
  remember('filters', persist);
}

export function applyTheme(t: 'system' | 'light' | 'dark'): void {
  theme.value = t;
  remember('theme', t);
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------------------------------------------------------------------
// Toasts

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}
export const toasts = signal<Toast[]>([]);
let toastSeq = 0;

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 4500): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value.slice(-3), { id, text, kind, action }];
  setTimeout(() => dismissToast(id), kind === 'error' ? Math.max(ms, 7000) : ms);
}
export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
export function toastError(e: unknown): void {
  toast(errorText(e), 'error');
}

// ---------------------------------------------------------------------------
// Job collection helpers

export function setJobs(list: JobSummary[]): void {
  jobsById.value = new Map(list.map((j) => [j.id, j]));
}
export function upsertJobs(list: JobSummary[]): void {
  if (!list.length) return;
  const next = new Map(jobsById.value);
  list.forEach((j) => next.set(j.id, j));
  jobsById.value = next;
}
export function removeJobs(ids: string[]): void {
  const next = new Map(jobsById.value);
  ids.forEach((id) => next.delete(id));
  jobsById.value = next;
}

export function applyBoot(data: BootstrapData): void {
  batch(() => {
    version.value = data.version;
    email.value = data.user.email;
    sheetUrl.value = data.sheetUrl;
    profile.value = data.profile;
    settings.value = data.settings;
    usage.value = data.usage;
    activity.value = data.activity;
    lastRefresh.value = data.lastRefresh;
    migratedFromV1.value = data.migratedFromV1;
    setJobs(data.jobs);
    loaded.value = true;
    bootError.value = '';
  });
}

export async function loadBoot(): Promise<void> {
  const embedded = window.__IIP_BOOT__ as { data: BootstrapData | null; error: string } | string | undefined;
  if (embedded && typeof embedded === 'object' && embedded.data) {
    applyBoot(embedded.data);
    return;
  }
  try {
    applyBoot(await call('bootstrap'));
  } catch (e) {
    bootError.value = errorText(e);
  }
}

async function refreshActivity(): Promise<void> {
  try {
    activity.value = (await call('getActivity', 40)).activity;
  } catch {
    /* non-critical */
  }
}

// ---------------------------------------------------------------------------
// Actions (optimistic where safe)

export async function updateJob(id: string, patch: JobPatch, quiet = false): Promise<JobSummary | null> {
  const before = jobsById.value.get(id);
  if (before && (patch.stage !== undefined || patch.starred !== undefined)) {
    upsertJobs([{ ...before, ...(patch.stage ? { stage: patch.stage } : {}), ...(patch.starred !== undefined ? { starred: patch.starred } : {}) }]);
  }
  try {
    const { job } = await call('updateJob', id, patch);
    upsertJobs([job]);
    if (patch.stage) void refreshActivity();
    return job;
  } catch (e) {
    if (before) upsertJobs([before]);
    if (!quiet) toastError(e);
    return null;
  }
}

export async function moveJob(id: string, stage: Stage): Promise<void> {
  const before = jobsById.value.get(id);
  if (!before || before.stage === stage) return;
  const ok = await updateJob(id, { stage });
  if (ok) {
    toast(`Moved to ${stageName(stage)}`, 'info', { label: 'Undo', run: () => void updateJob(id, { stage: before.stage }) });
  }
}

export function stageName(s: Stage): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function bulkUpdate(ids: string[], patch: { stage?: Stage; starred?: boolean }): Promise<void> {
  const before = ids.map((id) => jobsById.value.get(id)).filter((j): j is JobSummary => Boolean(j));
  upsertJobs(before.map((j) => ({ ...j, ...patch })));
  try {
    const { jobs: updated } = await call('bulkUpdate', ids, patch);
    upsertJobs(updated);
    toast(`${plural(updated.length, 'job')} updated`, 'info', patch.stage ? { label: 'Undo', run: () => before.forEach((j) => void updateJob(j.id, { stage: j.stage }, true)) } : undefined);
    void refreshActivity();
  } catch (e) {
    upsertJobs(before);
    toastError(e);
  }
}

export async function deleteJobs(ids: string[]): Promise<boolean> {
  try {
    const { deleted } = await call('deleteJobs', ids);
    removeJobs(deleted);
    if (openJobId.value && deleted.includes(openJobId.value)) openJobId.value = null;
    toast(`Deleted ${plural(deleted.length, 'job')}`);
    void refreshActivity();
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function refreshNow(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const out = await call('refreshNow');
    batch(() => {
      setJobs(out.jobs);
      lastRefresh.value = out.report;
      usage.value = out.usage;
    });
    const failed = out.report.sources.filter((s) => s.error);
    const msg =
      out.report.added > 0
        ? `${plural(out.report.added, 'new posting')} added${out.report.aiAnalyzed ? `, ${out.report.aiAnalyzed} analysed by AI` : ''}`
        : 'No new postings since the last refresh';
    toast(failed.length ? `${msg}. ${failed.length} source${failed.length > 1 ? 's' : ''} failed.` : msg, failed.length && !out.report.added ? 'error' : 'info');
    void refreshActivity();
  } catch (e) {
    toastError(e);
  } finally {
    refreshing.value = false;
  }
}

export async function analyze(ids: string[]): Promise<boolean> {
  try {
    const out = await call('analyzeWithAi', ids);
    upsertJobs(out.jobs);
    usage.value = out.usage;
    const done = out.jobs.filter((j) => j.aiStatus === 'done' && ids.includes(j.id)).length;
    if (out.error && !done) toast(out.error, 'error');
    else toast(out.error ? `Analysed ${done} of ${ids.length}. ${out.error}` : `AI analysis done for ${plural(done, 'job')}`);
    return done > 0;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function saveProfile(p: Profile): Promise<boolean> {
  try {
    const out = await call('saveProfile', p);
    batch(() => {
      profile.value = out.profile;
      setJobs(out.jobs);
    });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<boolean> {
  try {
    settings.value = (await call('saveSettings', patch)).settings;
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Derived

export const counts = computed(() => {
  const by: Record<Stage, number> = { discovered: 0, saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0, archived: 0 };
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  let newThisWeek = 0;
  let strong = 0;
  for (const j of jobs.value) {
    by[j.stage]++;
    if (j.createdAt > weekAgo && j.stage === 'discovered') newThisWeek++;
    if (j.score >= 80 && (j.stage === 'discovered' || j.stage === 'saved')) strong++;
  }
  return { by, newThisWeek, strong, active: by.saved + by.applied + by.interviewing + by.offer };
});

export const aiReady = computed(() => {
  const s = settings.value;
  if (!s || s.ai.provider === 'none') return false;
  return s.ai.provider === 'gemini' ? s.secrets.gemini : s.secrets.openai_compat;
});
