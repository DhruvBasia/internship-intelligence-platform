/**
 * Per-user settings, profile, secrets and usage counters. Profile and settings
 * live in public.profiles, small state in public.user_kv, and AI keys encrypted
 * in public.user_secrets (never sent to the browser: they become presence flags).
 */
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, mergeSettings, normalizeProfile } from '../../shared/defaults';
import type { AiProvider, DeepPartial, Degree, Profile, RefreshReport, Settings, SettingsView, UsageView, WorkMode } from '../../shared/types';
import { ctx } from '../platform/context';
import { encryptText } from '../platform/crypto';
import { localDayHour, props } from '../runtime';

const K = {
  usage: 'usage',
  cooldown: 'ai.cooldownUntil',
  lastRefresh: 'lastRefresh',
  lastDigest: 'lastDigestAt',
  modelCache: 'ai.models',
};

const secretName = (p: Exclude<AiProvider, 'none'>) => 'ai.' + p;

export function getSettings(): Settings {
  return mergeSettings(DEFAULT_SETTINGS, (ctx().profile.settings ?? {}) as DeepPartial<Settings>);
}

export function saveSettings(patch: DeepPartial<Settings>): Settings {
  const next = mergeSettings(getSettings(), patch);
  const c = ctx();
  c.profile.settings = next as unknown as Record<string, unknown>;
  c.profileDirty = true;
  return next;
}

export function settingsView(settings: Settings = getSettings()): SettingsView {
  return {
    ...settings,
    secrets: { gemini: Boolean(getSecret('gemini')), openai_compat: Boolean(getSecret('openai_compat')) },
  };
}

export function getProfile(): Profile {
  const p = ctx().profile;
  return normalizeProfile({
    ...DEFAULT_PROFILE,
    name: p.name,
    school: p.school,
    degree: p.degree as Degree,
    gradYear: p.grad_year,
    skills: p.skills ?? [],
    targetRoles: p.target_roles ?? [],
    locations: p.locations ?? [],
    workModes: (p.work_modes ?? []) as WorkMode[],
    needsSponsorship: p.needs_sponsorship,
    resumeText: p.resume_text,
    links: { ...DEFAULT_PROFILE.links, ...(p.links ?? {}) },
  });
}

export function saveProfile(input: Partial<Profile>): Profile {
  const profile = normalizeProfile(input);
  const c = ctx();
  Object.assign(c.profile, {
    name: profile.name,
    school: profile.school,
    degree: profile.degree,
    grad_year: profile.gradYear,
    skills: profile.skills,
    target_roles: profile.targetRoles,
    locations: profile.locations,
    work_modes: profile.workModes,
    needs_sponsorship: profile.needsSponsorship,
    resume_text: profile.resumeText,
    links: profile.links,
  });
  c.profileDirty = true;
  return profile;
}

export function getSecret(provider: Exclude<AiProvider, 'none'>): string {
  return (ctx().secrets.get(secretName(provider)) ?? '').trim();
}

export async function setSecret(provider: Exclude<AiProvider, 'none'>, key: string): Promise<void> {
  const c = ctx();
  const ciphertext = await encryptText(c.env.secretsKey, key.trim());
  await c.service.upsert('user_secrets', [{ user_id: c.userId, name: secretName(provider), ciphertext, updated_at: new Date().toISOString() }], ['user_id', 'name']);
  c.secrets.set(secretName(provider), key.trim());
}

export async function clearSecret(provider: Exclude<AiProvider, 'none'>): Promise<void> {
  const c = ctx();
  await c.service.delete('user_secrets', [
    { col: 'user_id', op: 'eq', value: c.userId },
    { col: 'name', op: 'eq', value: secretName(provider) },
  ]);
  c.secrets.delete(secretName(provider));
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

export function getModelCache(provider: AiProvider): { at: number; models: { id: string; label: string }[] } | null {
  const c = props.getJson<{ provider: string; at: number; models: { id: string; label: string }[] } | null>(K.modelCache, null);
  if (!c || c.provider !== provider || Date.now() - c.at > 7 * 86_400_000) return null;
  return c;
}

export function setModelCache(provider: AiProvider, models: { id: string; label: string }[]): void {
  props.setJson(K.modelCache, { provider, at: Date.now(), models: models.slice(0, 40) });
}
