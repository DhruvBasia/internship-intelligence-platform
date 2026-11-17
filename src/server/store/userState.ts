/**
 * Per-user settings, profile, secrets and usage counters, all in that user's
 * PropertiesService.getUserProperties(): fast to read, private to the user,
 * and never sent to the browser in raw form (secrets become presence flags).
 */
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, mergeSettings, normalizeProfile } from '../../shared/defaults';
import type { AiProvider, DeepPartial, Profile, RefreshReport, Settings, SettingsView, UsageView } from '../../shared/types';
import { getChunked, localDayHour, props, setChunked } from '../gas';

const K = {
  settings: 'iip.settings',
  profile: 'iip.profile',
  resume: 'iip.resume',
  usage: 'iip.usage',
  cooldown: 'iip.ai.cooldownUntil',
  lastRefresh: 'iip.lastRefresh',
  lastDigest: 'iip.lastDigestAt',
  v1Migrated: 'iip.v1migrated',
  modelCache: 'iip.ai.models',
  secret: (p: Exclude<AiProvider, 'none'>) => 'iip.secret.' + p,
};

export function getSettings(): Settings {
  return mergeSettings(DEFAULT_SETTINGS, props.getJson<DeepPartial<Settings>>(K.settings, {}));
}

export function saveSettings(patch: DeepPartial<Settings>): Settings {
  const next = mergeSettings(getSettings(), patch);
  props.setJson(K.settings, next);
  return next;
}

export function settingsView(settings: Settings = getSettings()): SettingsView {
  return {
    ...settings,
    secrets: { gemini: Boolean(getSecret('gemini')), openai_compat: Boolean(getSecret('openai_compat')) },
  };
}

export function getProfile(): Profile {
  const stored = props.getJson<Partial<Profile>>(K.profile, {});
  return normalizeProfile({ ...DEFAULT_PROFILE, ...stored, resumeText: getChunked(K.resume) });
}

export function saveProfile(input: Partial<Profile>): Profile {
  const profile = normalizeProfile(input);
  const { resumeText, ...rest } = profile;
  props.setJson(K.profile, rest);
  setChunked(K.resume, resumeText);
  return profile;
}

export function getSecret(provider: Exclude<AiProvider, 'none'>): string {
  return (props.get(K.secret(provider)) || '').trim();
}

export function setSecret(provider: Exclude<AiProvider, 'none'>, key: string): void {
  props.set(K.secret(provider), key.trim());
}

export function clearSecret(provider: Exclude<AiProvider, 'none'>): void {
  props.del(K.secret(provider));
}

// ---------------------------------------------------------------------------
// AI usage budget (per user, per local calendar day)

interface UsageRecord {
  date: string;
  aiRequests: number;
  aiJobs: number;
}

export function getUsage(settings: Settings = getSettings()): UsageView {
  const today = localDayHour(settings.automation.timezone).day;
  const rec = props.getJson<UsageRecord>(K.usage, { date: today, aiRequests: 0, aiJobs: 0 });
  const current = rec.date === today ? rec : { date: today, aiRequests: 0, aiJobs: 0 };
  const cooldown = props.get(K.cooldown) || '';
  return {
    ...current,
    dailyLimit: settings.ai.dailyLimit,
    cooldownUntil: cooldown && Date.parse(cooldown) > Date.now() ? cooldown : '',
  };
}

export function recordUsage(requests: number, jobs: number, settings: Settings = getSettings()): UsageView {
  const u = getUsage(settings);
  props.setJson(K.usage, { date: u.date, aiRequests: u.aiRequests + requests, aiJobs: u.aiJobs + jobs });
  return getUsage(settings);
}

export function setCooldown(untilIso: string): void {
  props.set(K.cooldown, untilIso);
}

export function remainingAiRequests(settings: Settings = getSettings()): number {
  const u = getUsage(settings);
  if (u.cooldownUntil) return 0;
  return Math.max(0, settings.ai.dailyLimit - u.aiRequests);
}

// ---------------------------------------------------------------------------
// Misc small state

export function getLastRefresh(): RefreshReport | null {
  return props.getJson<RefreshReport | null>(K.lastRefresh, null);
}

export function setLastRefresh(report: RefreshReport): void {
  const trimmed: RefreshReport = {
    ...report,
    sources: report.sources.slice(0, 50).map((s) => ({ ...s, error: s.error.slice(0, 160) })),
    aiError: report.aiError.slice(0, 200),
  };
  props.setJson(K.lastRefresh, trimmed);
}

export function getLastDigestAt(): string {
  return props.get(K.lastDigest) || '';
}

export function setLastDigestAt(iso: string): void {
  props.set(K.lastDigest, iso);
}

export function getV1Migrated(): number {
  return Number(props.get(K.v1Migrated) || 0);
}

export function setV1Migrated(count: number): void {
  props.set(K.v1Migrated, String(count));
}

export function getModelCache(provider: AiProvider): { at: number; models: { id: string; label: string }[] } | null {
  const c = props.getJson<{ provider: string; at: number; models: { id: string; label: string }[] } | null>(K.modelCache, null);
  if (!c || c.provider !== provider || Date.now() - c.at > 7 * 86_400_000) return null;
  return c;
}

export function setModelCache(provider: AiProvider, models: { id: string; label: string }[]): void {
  props.setJson(K.modelCache, { provider, at: Date.now(), models: models.slice(0, 40) });
}
