/**
 * Bring-your-own-key AI clients. Every student uses their own free key, so the
 * app costs nothing to run and one person's usage never touches another's.
 *
 * - Gemini (Google AI Studio free tier): default; schema-constrained JSON.
 * - Any OpenAI-compatible endpoint (Groq, OpenRouter free models, ...).
 */
import { safeHttpUrl, urlHost } from '../../shared/text';
import type { AiProvider, ModelInfo, Settings } from '../../shared/types';
import { AppError } from '../errors';
import { httpFetch, sleep, type HttpResponse } from '../gas';
import { log } from '../log';
import { getModelCache, getSecret, saveSettings, setCooldown, setModelCache } from '../store/userState';
import { extractJson } from './prompts';

export interface AiClient {
  provider: Exclude<AiProvider, 'none'>;
  model: string;
  json(system: string, user: string, schema: object): unknown;
  text(system: string, user: string): string;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

/** Parse provider error bodies into a user-facing AppError, and set a cooldown on quota errors. */
function providerError(provider: string, res: HttpResponse): AppError {
  if (res.error) return new AppError('AI_FAILED', `Could not reach ${provider}: ${res.error}`);
  let message = '';
  let retrySeconds = 0;
  let perDay = false;
  try {
    const body = JSON.parse(res.text) as { error?: { message?: string; details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] } | string };
    const err = body.error;
    if (typeof err === 'string') message = err;
    else if (err) {
      message = err.message ?? '';
      for (const d of err.details ?? []) {
        if (d.retryDelay) retrySeconds = parseFloat(d.retryDelay) || retrySeconds;
        if ((d.violations ?? []).some((v) => /PerDay/i.test(v.quotaId ?? ''))) perDay = true;
      }
    }
  } catch {
    message = res.text.slice(0, 200);
  }
  if (res.status === 429) {
    const ms = perDay ? 6 * 3600_000 : Math.max(30, retrySeconds || 60) * 1000;
    setCooldown(new Date(Date.now() + ms).toISOString());
    return new AppError(
      'AI_QUOTA',
      perDay
        ? `${provider} daily free quota is used up. Free scores still work; AI analysis resumes later.`
        : `${provider} is rate-limiting requests. AI analysis will continue in about ${Math.ceil(ms / 60000)} min.`,
    );
  }
  if (res.status === 401 || res.status === 403 || /api key not valid|invalid api key|API_KEY_INVALID|unauthorized/i.test(message)) {
    return new AppError('AI_NOT_CONFIGURED', `${provider} rejected the API key. Check it in Settings → AI.`);
  }
  if (res.status === 404) {
    return new AppError('AI_FAILED', `${provider} could not find that model. Pick another model in Settings → AI.`, { modelMissing: true });
  }
  return new AppError('AI_FAILED', `${provider} error (${res.status}): ${message.slice(0, 160) || 'unknown error'}`);
}

/** POST with one retry on transient 5xx / network errors. */
function postJson(url: string, headers: Record<string, string>, body: unknown): HttpResponse {
  let res = httpFetch({ url, method: 'post', headers, body: JSON.stringify(body) });
  if (res.status >= 500 || res.status === 0) {
    sleep(1500);
    res = httpFetch({ url, method: 'post', headers, body: JSON.stringify(body) });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Gemini

interface GeminiModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

export function rankGeminiModels(models: GeminiModel[]): ModelInfo[] {
  const excluded = /embedding|aqa|imagen|veo|tts|live|image|audio|robotics|computer-use|learnlm|gemma|nano|banana|thinking-exp|deep-research/i;
  const score = (id: string) => {
    let s = 0;
    if (/flash-latest$/.test(id)) s += 100;
    else if (/flash-lite-latest$/.test(id)) s += 70;
    else if (/flash/.test(id) && !/lite/.test(id)) s += 80;
    else if (/flash-lite/.test(id)) s += 60;
    else if (/pro/.test(id)) s += 30;
    if (/preview|exp/.test(id)) s -= 20;
    const v = /gemini-(\d+(?:\.\d+)?)/.exec(id);
    if (v) s += parseFloat(v[1]!);
    return s;
  };
  return models
    .filter((m) => m.name && (m.supportedGenerationMethods ?? []).includes('generateContent') && !excluded.test(m.name))
    .map((m) => ({ id: m.name!.replace(/^models\//, ''), label: m.displayName || m.name!.replace(/^models\//, '') }))
    .sort((a, b) => score(b.id) - score(a.id))
    .slice(0, 25);
}

export function listGeminiModels(key: string): ModelInfo[] {
  const res = httpFetch({ url: `${GEMINI_BASE}/models?pageSize=200`, headers: { 'x-goog-api-key': key } });
  if (res.status !== 200) throw providerError('Gemini', res);
  const body = JSON.parse(res.text) as { models?: GeminiModel[] };
  return rankGeminiModels(body.models ?? []);
}

function geminiClient(key: string, configuredModel: string): AiClient {
  let model = configuredModel || getModelCache('gemini')?.models[0]?.id || GEMINI_FALLBACK_MODEL;

  const call = (system: string, user: string, schema: object | null): string => {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: schema
        ? { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema }
        : { temperature: 0.6 },
    };
    const send = () => postJson(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body);
    let res = send();
    if (res.status === 404) {
      // The configured model was retired: switch to the best currently available one, once.
      const models = listGeminiModels(key);
      setModelCache('gemini', models);
      if (models[0] && models[0].id !== model) {
        log.warn('ai.model_switched', { from: model, to: models[0].id });
        model = models[0].id;
        saveSettings({ ai: { model } });
        res = send();
      }
    }
    if (res.status !== 200) throw providerError('Gemini', res);
    const data = JSON.parse(res.text) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) throw new AppError('AI_FAILED', `Gemini blocked the request (${data.promptFeedback.blockReason}).`);
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    if (!text) throw new AppError('AI_FAILED', `Gemini returned no text (${cand?.finishReason ?? 'unknown reason'}).`);
    return text;
  };

  return {
    provider: 'gemini',
    get model() {
      return model;
    },
    json: (system, user, schema) => extractJson(call(system, user, schema)),
    text: (system, user) => call(system, user, null).trim(),
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (Groq, OpenRouter, ...)

interface CompatModel {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

export function rankCompatModels(baseUrl: string, models: CompatModel[]): ModelInfo[] {
  const openrouter = /openrouter\.ai$/.test(urlHost(baseUrl));
  const excluded = /whisper|tts|guard|embed|vision-preview|audio|image|moderation|playai|orpheus|transcribe/i;
  const prefer = [/gpt-oss-120b/, /llama-3\.3-70b/, /llama-4/, /qwen.*(32b|72b|235b)/, /deepseek/, /70b/, /gemma.*27b/, /mixtral/];
  const rank = (id: string) => {
    const i = prefer.findIndex((re) => re.test(id));
    return i < 0 ? prefer.length : i;
  };
  return models
    .filter((m) => m.id && !excluded.test(m.id))
    .filter((m) => !openrouter || (m.pricing?.prompt === '0' && m.pricing?.completion === '0') || /:free$/.test(m.id!))
    .map((m) => ({ id: m.id!, label: m.name || m.id! }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .slice(0, 40);
}

export function listCompatModels(baseUrl: string, key: string): ModelInfo[] {
  const res = httpFetch({ url: `${baseUrl}/models`, headers: { Authorization: `Bearer ${key}` } });
  if (res.status !== 200) throw providerError(providerName(baseUrl), res);
  const body = JSON.parse(res.text) as { data?: CompatModel[] };
  return rankCompatModels(baseUrl, body.data ?? []);
}

function providerName(baseUrl: string): string {
  const host = urlHost(baseUrl);
  if (/groq\.com$/.test(host)) return 'Groq';
  if (/openrouter\.ai$/.test(host)) return 'OpenRouter';
  return host || 'AI provider';
}

function compatClient(baseUrl: string, key: string, configuredModel: string): AiClient {
  const name = providerName(baseUrl);
  const model = configuredModel || getModelCache('openai_compat')?.models[0]?.id || '';
  if (!model) throw new AppError('AI_NOT_CONFIGURED', `Choose a ${name} model in Settings → AI.`);
  const headers = { Authorization: `Bearer ${key}`, 'X-Title': 'InternIQ' };

  const call = (system: string, user: string, json: boolean): string => {
    const body: Record<string, unknown> = {
      model,
      temperature: json ? 0.2 : 0.6,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (json) body.response_format = { type: 'json_object' };
    let res = postJson(`${baseUrl}/chat/completions`, headers, body);
    if (json && res.status === 400 && /response_format|json/i.test(res.text)) {
      delete body.response_format;
      res = postJson(`${baseUrl}/chat/completions`, headers, body);
    }
    if (res.status !== 200) throw providerError(name, res);
    const data = JSON.parse(res.text) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AppError('AI_FAILED', `${name} returned an empty reply.`);
    return text;
  };

  return {
    provider: 'openai_compat',
    model,
    json: (system, user) => extractJson(call(system, user, true)),
    text: (system, user) => call(system, user, false).trim(),
  };
}

// ---------------------------------------------------------------------------

/** The configured client, or null when the user chose the free built-in matcher only. */
export function getClient(settings: Settings): AiClient | null {
  const p = settings.ai.provider;
  if (p === 'none') return null;
  const key = getSecret(p);
  if (!key) return null;
  if (p === 'gemini') return geminiClient(key, settings.ai.model);
  const base = safeHttpUrl(settings.ai.baseUrl);
  if (!base) return null;
  return compatClient(base.replace(/\/+$/, ''), key, settings.ai.model);
}

export function requireClient(settings: Settings): AiClient {
  const client = getClient(settings);
  if (!client) {
    throw new AppError('AI_NOT_CONFIGURED', 'AI is not set up yet. Add a free Gemini or Groq key in Settings → AI, or keep using free scores.');
  }
  return client;
}

export function listModelsFor(settings: Settings, keyOverride?: string): ModelInfo[] {
  const p = settings.ai.provider;
  if (p === 'none') return [];
  const key = keyOverride ?? getSecret(p);
  if (!key) return [];
  let models: ModelInfo[];
  if (p === 'gemini') {
    models = listGeminiModels(key);
  } else {
    const base = safeHttpUrl(settings.ai.baseUrl).replace(/\/+$/, '');
    if (!base) throw new AppError('BAD_INPUT', 'Choose a provider (Groq, OpenRouter) or enter its API base URL first.');
    models = listCompatModels(base, key);
  }
  setModelCache(p, models);
  return models;
}
