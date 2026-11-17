import { useEffect, useState } from 'preact/hooks';
import { Building2, ExternalLink, FileSpreadsheet, KeyRound, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, X } from 'lucide-preact';
import { SUGGESTED_BOARDS } from '../../shared/boards';
import { OPENAI_COMPAT_PRESETS, SIMPLIFY_CATEGORIES } from '../../shared/defaults';
import { allSkillNames } from '../../shared/skills';
import type { Board, Degree, ModelInfo, Profile, SettingsView as SV, WorkMode } from '../../shared/types';
import { call, errorText } from '../api';
import { copyText, downloadText, jobsToCsv } from '../lib/files';
import { plural } from '../lib/format';
import { addOpen, aiReady, features, jobs, profile, remember, saveProfile, saveSettings, setJobs, settings, sheetUrl, toast, toastError, usage, version } from '../state';
import { Button, Callout, ChipsInput, ExtLink, Field, Meter, Toggle } from '../ui';

type Tab = 'profile' | 'ai' | 'sources' | 'automation' | 'mail' | 'data';

export const ROLE_SUGGESTIONS = ['Machine Learning', 'Data Science', 'Software Engineering', 'AI Research', 'Computer Vision', 'NLP', 'Data Engineering', 'Backend', 'Frontend', 'Full Stack', 'Quant', 'Product Management', 'Robotics', 'Security', 'Hardware', 'Research'];
export const SKILL_SUGGESTIONS = allSkillNames();
export const LOCATION_SUGGESTIONS = ['India', 'Bengaluru', 'Delhi NCR', 'Hyderabad', 'Mumbai', 'Pune', 'USA', 'San Francisco', 'New York', 'Seattle', 'Canada', 'Toronto', 'London', 'Europe', 'Singapore', 'Remote'];

export function ProfileForm({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...value, [k]: v });
  const year = new Date().getFullYear();
  return (
    <div class="stack">
      <div class="grid cols-2" style={{ gap: 12 }}>
        <Field label="Name" id="p-name" hint="Used in cover letters and the email digest.">
          <input id="p-name" class="input" value={value.name} onInput={(e) => set('name', (e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label="School" id="p-school">
          <input id="p-school" class="input" value={value.school} onInput={(e) => set('school', (e.currentTarget as HTMLInputElement).value)} placeholder="GGSIPU EDC" />
        </Field>
        <Field label="Degree" id="p-degree">
          <select id="p-degree" class="select" value={value.degree} onChange={(e) => set('degree', (e.currentTarget as HTMLSelectElement).value as Degree)}>
            <option value="">Choose…</option>
            <option value="bachelors">Bachelor's (B.Tech, B.E., B.Sc…)</option>
            <option value="masters">Master's</option>
            <option value="phd">PhD</option>
            <option value="highschool">High school</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Graduation year" id="p-year">
          <select id="p-year" class="select" value={value.gradYear ?? ''} onChange={(e) => set('gradYear', Number((e.currentTarget as HTMLSelectElement).value) || null)}>
            <option value="">Choose…</option>
            {Array.from({ length: 9 }, (_, i) => year - 1 + i).map((y) => (
              <option value={y}>{y}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Target roles" id="p-roles" hint="Postings whose titles match these are pulled in and score higher. Press Enter after each.">
        <ChipsInput id="p-roles" values={value.targetRoles} onChange={(v) => set('targetRoles', v)} suggestions={ROLE_SUGGESTIONS} placeholder="Machine Learning, Data Science…" />
      </Field>
      <Field label="Skills" id="p-skills" hint="Skills found in your resume count automatically; add anything it misses.">
        <ChipsInput id="p-skills" values={value.skills} onChange={(v) => set('skills', v)} suggestions={SKILL_SUGGESTIONS} placeholder="Python, PyTorch, SQL…" max={80} />
      </Field>
      <Field label="Preferred locations" id="p-locs">
        <ChipsInput id="p-locs" values={value.locations} onChange={(v) => set('locations', v)} suggestions={LOCATION_SUGGESTIONS} placeholder="Bengaluru, Remote…" />
      </Field>
      <div class="field">
        <span class="field-label">Work modes you're open to</span>
        <div class="row wrap">
          {(['remote', 'hybrid', 'onsite'] as WorkMode[]).map((m) => (
            <button type="button" class="chip" aria-pressed={value.workModes.includes(m)} onClick={() => set('workModes', value.workModes.includes(m) ? value.workModes.filter((x) => x !== m) : [...value.workModes, m])}>
              {m === 'onsite' ? 'On-site' : m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <Toggle checked={value.needsSponsorship} onChange={(v) => set('needsSponsorship', v)} label="I need visa sponsorship for roles abroad" hint="Flags postings that require citizenship or won't sponsor." />
      <Field label="Resume" id="p-resume" hint={`${value.resumeText.length.toLocaleString()} / 20,000 characters. Paste the text of your resume; phone numbers and emails are stripped before anything is sent to an AI.`}>
        <textarea id="p-resume" class="textarea" rows={10} value={value.resumeText} onInput={(e) => set('resumeText', (e.currentTarget as HTMLTextAreaElement).value)} placeholder="Paste your resume text here (projects, experience, skills, coursework)…" />
      </Field>
      <div class="grid cols-3" style={{ gap: 12 }}>
        {(['github', 'linkedin', 'portfolio'] as const).map((k) => (
          <Field label={k === 'github' ? 'GitHub' : k === 'linkedin' ? 'LinkedIn' : 'Portfolio'} id={`p-${k}`}>
            <input id={`p-${k}`} class="input" type="url" value={value.links[k]} placeholder="https://" onInput={(e) => set('links', { ...value.links, [k]: (e.currentTarget as HTMLInputElement).value })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

function ProfileTab() {
  const [draft, setDraft] = useState<Profile>(profile.value!);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.value);
  return (
    <section class="card card-pad stack">
      <ProfileForm value={draft} onChange={setDraft} />
      <div class="row">
        <span class="small muted">Saving recalculates every free score instantly.</span>
        <span class="spacer" />
        <Button disabled={!dirty} onClick={() => setDraft(profile.value!)}>
          Discard
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!dirty}
          onClick={async () => {
            setBusy(true);
            if (await saveProfile(draft)) toast('Profile saved; scores updated');
            setBusy(false);
          }}
        >
          Save profile
        </Button>
      </div>
    </section>
  );
}

type ProviderChoice = 'none' | 'gemini' | 'groq' | 'openrouter' | 'custom';

function providerChoice(s: SV): ProviderChoice {
  if (s.ai.provider === 'none') return 'none';
  if (s.ai.provider === 'gemini') return 'gemini';
  const preset = OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl === s.ai.baseUrl);
  return preset ? (preset.id as ProviderChoice) : 'custom';
}

export function AiSetup({ compact }: { compact?: boolean }) {
  const s = settings.value!;
  const [choice, setChoice] = useState<ProviderChoice>(providerChoice(s));
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(s.ai.provider === 'openai_compat' ? s.ai.baseUrl : '');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const provider = choice === 'none' ? 'none' : choice === 'gemini' ? 'gemini' : 'openai_compat';
  const hasKey = provider === 'gemini' ? s.secrets.gemini : provider === 'openai_compat' ? s.secrets.openai_compat : false;
  const preset = OPENAI_COMPAT_PRESETS.find((p) => p.id === choice);
  const keyUrl = choice === 'gemini' ? 'https://aistudio.google.com/app/apikey' : preset?.keyUrl ?? '';
  const active = s.ai.provider === provider && (provider === 'none' || hasKey);

  useEffect(() => {
    if (active && provider !== 'none' && !compact) {
      call('listModels').then((r) => setModels(r.models)).catch(() => undefined);
    }
  }, [active, provider]);

  const connect = async () => {
    setBusy('connect');
    setError('');
    try {
      if (provider === 'openai_compat') {
        const url = preset?.baseUrl ?? baseUrl.trim();
        if (!(await saveSettings({ ai: { provider: 'openai_compat', baseUrl: url, model: '' } }))) return;
      }
      const out = await call('setSecret', provider as 'gemini' | 'openai_compat', key.trim());
      settings.value = out.settings;
      setModels(out.models);
      setKey('');
      toast(`Connected. Using ${out.settings.ai.model || 'the default model'}.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const options: { id: ProviderChoice; title: string; body: string }[] = [
    { id: 'none', title: 'Free built-in matcher only', body: 'No key, no limits, nothing leaves Google. Scores skills, role fit, eligibility and location with rules.' },
    { id: 'gemini', title: 'Google Gemini (free key, recommended)', body: 'Deeper analysis and written cover letters. Get a free key from Google AI Studio in a minute.' },
    { id: 'groq', title: 'Groq (free key)', body: 'Very fast open models (Llama, GPT-OSS) on a free tier.' },
    { id: 'openrouter', title: 'OpenRouter (free models)', body: 'One key, many models; only free ones are listed.' },
  ];
  if (!compact) options.push({ id: 'custom', title: 'Other OpenAI-compatible API', body: 'Any endpoint that speaks the OpenAI chat format.' });

  return (
    <div class="stack">
      <div class="grid" style={{ gap: 8 }} role="radiogroup" aria-label="Analysis engine">
        {options.map((o) => (
          <div
            class="choice"
            role="radio"
            aria-checked={choice === o.id}
            aria-label={o.title}
            aria-description={o.body}
            tabIndex={0}
            onClick={() => setChoice(o.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setChoice(o.id))}
          >
            <span class="radio" />
            <div>
              <h4>
                {o.title} {providerChoice(s) === o.id && (o.id === 'none' || hasKey) ? <span class="badge strong" style={{ marginLeft: 6 }}>Active</span> : null}
              </h4>
              <p>{o.body}</p>
            </div>
          </div>
        ))}
      </div>

      {choice === 'none' ? (
        s.ai.provider !== 'none' ? (
          <div>
            <Button loading={busy === 'none'} onClick={async () => (setBusy('none'), await saveSettings({ ai: { provider: 'none' } }), setBusy(''), toast('Using the free matcher only'))}>
              Switch to free matcher only
            </Button>
          </div>
        ) : null
      ) : (
        <div class="stack" style={{ gap: 10 }}>
          {choice === 'custom' ? (
            <Field label="API base URL" id="ai-base" hint="For example https://api.example.com/v1 (must end before /chat/completions).">
              <input id="ai-base" class="input" type="url" value={baseUrl} onInput={(e) => setBaseUrl((e.currentTarget as HTMLInputElement).value)} />
            </Field>
          ) : null}
          <Field
            label={hasKey && providerChoice(s) === choice ? 'Replace API key' : 'API key'}
            id="ai-key"
            hint={
              <>
                {keyUrl ? (
                  <ExtLink href={keyUrl}>
                    Get a free key <ExternalLink size={11} />
                  </ExtLink>
                ) : null}
                {' · '}Stored only in your own Google account (Apps Script user properties), never in the sheet or the browser.
              </>
            }
          >
            <div class="row">
              <input id="ai-key" class="input" type="password" autoComplete="off" spellcheck={false} value={key} placeholder={hasKey && providerChoice(s) === choice ? '•••••••• saved' : 'Paste your key'} onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
              <Button variant="primary" loading={busy === 'connect'} disabled={key.trim().length < 16 || (choice === 'custom' && !baseUrl)} onClick={() => void connect()}>
                <KeyRound size={15} /> Verify & save
              </Button>
            </div>
          </Field>
          {error ? <Callout kind="error">{error}</Callout> : null}
        </div>
      )}

      {!compact && active && provider !== 'none' ? (
        <div class="stack" style={{ gap: 14 }}>
          <div class="divider" style={{ margin: 0 }} />
          <div class="grid cols-2" style={{ gap: 12 }}>
            <Field label="Model" id="ai-model" hint="Ranked best-first for free use. If a model is retired, InternIQ switches automatically.">
              <select id="ai-model" class="select" value={s.ai.model} onChange={(e) => void saveSettings({ ai: { model: (e.currentTarget as HTMLSelectElement).value } })}>
                {models.length ? null : <option value={s.ai.model}>{s.ai.model || 'Default'}</option>}
                {models.map((m) => (
                  <option value={m.id}>{m.label === m.id ? m.id : `${m.label} (${m.id})`}</option>
                ))}
              </select>
            </Field>
            <Field label="Daily AI request limit" id="ai-limit" hint={`Each request analyses up to ${s.ai.batchSize} jobs. Keep it under your provider's free daily quota.`}>
              <input id="ai-limit" class="input" type="number" min={0} max={2000} value={s.ai.dailyLimit} onChange={(e) => void saveSettings({ ai: { dailyLimit: Number((e.currentTarget as HTMLInputElement).value) } })} />
            </Field>
          </div>
          <Toggle checked={s.ai.autoAnalyze} onChange={(v) => void saveSettings({ ai: { autoAnalyze: v } })} label="Analyse promising new postings automatically" hint={`New postings with a free score of ${s.ai.autoMinScore}+ are queued and analysed within your daily limit.`} />
          <label class="row small ink-2" style={{ gap: 10 }}>
            Auto-analyse threshold
            <input type="range" min={30} max={90} step={5} value={s.ai.autoMinScore} onChange={(e) => void saveSettings({ ai: { autoMinScore: Number((e.currentTarget as HTMLInputElement).value) } })} />
            <span class="num">{s.ai.autoMinScore}</span>
          </label>
          {usage.value ? (
            <div class="stack" style={{ gap: 6, maxWidth: 360 }}>
              <div class="row small">
                <span>Used today</span>
                <span class="spacer" />
                <span class="num">
                  {usage.value.aiRequests}/{usage.value.dailyLimit} requests · {usage.value.aiJobs} jobs
                </span>
              </div>
              <Meter value={usage.value.aiRequests} max={usage.value.dailyLimit} label="AI requests used today" />
              {usage.value.cooldownUntil ? <span class="small neg">Provider asked us to pause until {new Date(usage.value.cooldownUntil).toLocaleTimeString()}.</span> : null}
            </div>
          ) : null}
          <div class="row wrap">
            <Button
              loading={busy === 'test'}
              onClick={async () => {
                setBusy('test');
                try {
                  const r = await call('testAi');
                  toast(`AI is working: ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s`);
                  usage.value = (await call('getUsage')).usage;
                } catch (e) {
                  toastError(e);
                } finally {
                  setBusy('');
                }
              }}
            >
              <Sparkles size={15} /> Test connection
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('Remove this API key? AI analysis stops; free scores keep working.')) return;
                try {
                  settings.value = (await call('clearSecret', provider as 'gemini' | 'openai_compat')).settings;
                  setChoice('none');
                  toast('Key removed');
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              <Trash2 size={15} /> Remove key
            </Button>
          </div>
        </div>
      ) : null}
      {!compact ? (
        <Callout kind="plain">
          <strong>Privacy.</strong> Only the posting text and your profile (with phone numbers, emails and LinkedIn links stripped) are sent to the provider you choose, using your own key. Free tiers may use prompts to improve their models; check your provider's terms if that matters to you.
        </Callout>
      ) : null}
    </div>
  );
}

function BoardPicker({ boards, onChange }: { boards: Board[]; onChange: (b: Board[]) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ board: Board; openRoles: number; internRoles: number } | null>(null);
  const [error, setError] = useState('');
  const followed = new Set(boards.map((b) => b.ats + ':' + b.token));
  const lookup = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFound(null);
    try {
      setFound(await call('resolveBoard', q.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const follow = (b: Board) => {
    if (!followed.has(b.ats + ':' + b.token)) onChange([...boards, { ats: b.ats, token: b.token, name: b.name }]);
  };
  const groups = Array.from(new Set(SUGGESTED_BOARDS.map((b) => b.group)));
  return (
    <div class="stack">
      {boards.length ? (
        <div class="row wrap" style={{ gap: 6 }}>
          {boards.map((b) => (
            <span class="chip static" title={`${b.ats}:${b.token}`}>
              <Building2 size={13} /> {b.name}
              <button type="button" aria-label={`Unfollow ${b.name}`} onClick={() => onChange(boards.filter((x) => !(x.ats === b.ats && x.token === b.token)))}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p class="small muted">Not following any companies yet.</p>
      )}
      <form class="row" onSubmit={lookup}>
        <input class="input" placeholder="Company name or careers page URL (Greenhouse, Lever, Ashby)" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} aria-label="Find a company job board" />
        <Button type="submit" loading={busy} disabled={!q.trim()}>
          Find
        </Button>
      </form>
      {error ? <Callout kind="warn">{error}</Callout> : null}
      {found ? (
        <div class="callout info">
          <Building2 size={16} />
          <div class="row wrap" style={{ flex: 1 }}>
            <span>
              <strong>{found.board.name}</strong> on {found.board.ats}: {plural(found.openRoles, 'open role')}, {found.internRoles} look like internships.
            </span>
            <span class="spacer" />
            <Button size="sm" variant="primary" disabled={followed.has(found.board.ats + ':' + found.board.token)} onClick={() => (follow(found.board), setFound(null), setQ(''))}>
              <Plus size={14} /> Follow
            </Button>
          </div>
        </div>
      ) : null}
      <div class="stack" style={{ gap: 10 }}>
        {groups.map((g) => (
          <div>
            <div class="tiny muted" style={{ marginBottom: 6 }}>
              {g}
            </div>
            <div class="row wrap" style={{ gap: 6 }}>
              {SUGGESTED_BOARDS.filter((b) => b.group === g).map((b) => {
                const on = followed.has(b.ats + ':' + b.token);
                return (
                  <button type="button" class="chip" aria-pressed={on} onClick={() => (on ? onChange(boards.filter((x) => !(x.ats === b.ats && x.token === b.token))) : follow(b))}>
                    {on ? '✓ ' : '+ '}
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcesTab() {
  const s = settings.value!;
  return (
    <div class="stack">
      <section class="card card-pad stack">
        <h3 style={{ fontSize: 15 }}>Internship lists</h3>
        <Toggle checked={s.sources.simplify.enabled} onChange={(v) => void saveSettings({ sources: { simplify: { enabled: v } } })} label="SimplifyJobs internship list" hint="Community-maintained list of thousands of live internships, updated daily." />
        {s.sources.simplify.enabled ? (
          <div class="row wrap" style={{ gap: 6, paddingLeft: 44 }}>
            {SIMPLIFY_CATEGORIES.map((c) => {
              const on = s.sources.simplify.categories.includes(c);
              return (
                <button type="button" class="chip" aria-pressed={on} onClick={() => void saveSettings({ sources: { simplify: { categories: on ? s.sources.simplify.categories.filter((x) => x !== c) : [...s.sources.simplify.categories, c] } } })}>
                  {c}
                </button>
              );
            })}
          </div>
        ) : null}
        <Toggle checked={s.sources.hn.enabled} onChange={(v) => void saveSettings({ sources: { hn: { enabled: v } } })} label="Hacker News jobs" hint="Startup roles; mostly full-time, so the internships-only filter removes most." />
        <Toggle checked={s.sources.wwr.enabled} onChange={(v) => void saveSettings({ sources: { wwr: { enabled: v } } })} label="We Work Remotely (programming)" hint="Remote roles; rarely internships." />
      </section>
      <section class="card card-pad stack">
        <div>
          <h3 style={{ fontSize: 15 }}>Companies you follow</h3>
          <p class="small muted">InternIQ checks their public job boards on every refresh and pulls in new internship postings with full descriptions.</p>
        </div>
        <BoardPicker boards={s.sources.boards} onChange={(boards) => void saveSettings({ sources: { boards } })} />
      </section>
      <section class="card card-pad stack">
        <h3 style={{ fontSize: 15 }}>Filters</h3>
        <Toggle checked={s.filters.internshipsOnly} onChange={(v) => void saveSettings({ filters: { internshipsOnly: v } })} label="Internships, co-ops and student programmes only" />
        <Field label="Extra keywords to include" id="f-inc" hint="Besides your target roles. A posting must match at least one role or keyword.">
          <ChipsInput id="f-inc" values={s.filters.includeKeywords} onChange={(v) => void saveSettings({ filters: { includeKeywords: v } })} placeholder="e.g. LLM, research" />
        </Field>
        <Field label="Exclude titles containing" id="f-exc">
          <ChipsInput id="f-exc" values={s.filters.excludeKeywords} onChange={(v) => void saveSettings({ filters: { excludeKeywords: v } })} placeholder="e.g. senior, sales" />
        </Field>
        <div class="grid cols-2" style={{ gap: 12 }}>
          <Field label="Ignore postings older than (days)" id="f-age">
            <input id="f-age" class="input" type="number" min={1} max={365} value={s.filters.maxAgeDays} onChange={(e) => void saveSettings({ filters: { maxAgeDays: Number((e.currentTarget as HTMLInputElement).value) } })} />
          </Field>
          <Field label="Max new postings per refresh" id="f-max">
            <input id="f-max" class="input" type="number" min={10} max={500} value={s.filters.maxNewPerRefresh} onChange={(e) => void saveSettings({ filters: { maxNewPerRefresh: Number((e.currentTarget as HTMLInputElement).value) } })} />
          </Field>
        </div>
      </section>
    </div>
  );
}

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney'];

function AutomationTab() {
  const s = settings.value!;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = Array.from(new Set([s.automation.timezone, browserTz, ...TIMEZONES].filter(Boolean)));
  return (
    <section class="card card-pad stack">
      <Toggle
        checked={s.automation.enabled}
        onChange={(v) => void saveSettings({ automation: { enabled: v, timezone: s.automation.timezone || browserTz } }).then((ok) => ok && toast(v ? 'Daily refresh scheduled' : 'Daily refresh turned off'))}
        label="Refresh automatically every day"
        hint="Runs in your Google account even when this page is closed, then works through queued AI analysis in the following hours."
      />
      <div class="grid cols-2" style={{ gap: 12 }}>
        <Field label="Time of day" id="a-hour">
          <select id="a-hour" class="select" value={s.automation.hour} onChange={(e) => void saveSettings({ automation: { hour: Number((e.currentTarget as HTMLSelectElement).value) } })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</option>
            ))}
          </select>
        </Field>
        <Field label="Time zone" id="a-tz">
          <select id="a-tz" class="select" value={s.automation.timezone} onChange={(e) => void saveSettings({ automation: { timezone: (e.currentTarget as HTMLSelectElement).value } })}>
            {zones.map((z) => (
              <option value={z}>{z}</option>
            ))}
          </select>
        </Field>
      </div>
      <div class="divider" style={{ margin: '4px 0' }} />
      <Toggle checked={s.automation.digest} onChange={(v) => void saveSettings({ automation: { digest: v } })} label="Email me a daily digest of new strong matches" hint="Sent from and to your own Gmail address, only on days with new matches." />
      <label class="row small ink-2" style={{ gap: 10 }}>
        Include matches scoring at least
        <input type="range" min={50} max={95} step={5} value={s.automation.digestThreshold} onChange={(e) => void saveSettings({ automation: { digestThreshold: Number((e.currentTarget as HTMLInputElement).value) } })} />
        <span class="num">{s.automation.digestThreshold}</span>
      </label>
      {!s.automation.enabled ? <Callout kind="plain">Digests are sent after the daily refresh, so turn that on first.</Callout> : null}
    </section>
  );
}

function MailTab() {
  const s = settings.value!;
  if (!features.value.mail) {
    return (
      <section class="card card-pad stack">
        <h3 style={{ fontSize: 15 }}>Email scanning is not part of this deployment</h3>
        <p class="small ink-2">
          This is the public build, which never asks for Gmail access. To have InternIQ read your placement, admissions and exam emails (read-only), deploy your own copy with <code>private/config.json</code> set to <code>{'{ "mail": true }'}</code>. See docs/DEPLOY.md.
        </p>
      </section>
    );
  }
  return (
    <section class="card card-pad stack">
      <Toggle checked={s.mail.enabled} onChange={(v) => void saveSettings({ mail: { enabled: v } })} label="Scan my inbox every hour" hint="Reads only new placement, application, admissions, exam and deadline emails. Never sends, deletes, labels or changes anything in Gmail." />
      <Toggle checked={s.mail.autoTrack} onChange={(v) => void saveSettings({ mail: { autoTrack: v } })} label="Update applications from emails" hint="Application confirmations, assessments, interviews, offers and rejections move the matching internship along your pipeline (never backwards); new companies are added." />
      <Field label="First scan looks back (days)" id="m-look">
        <input id="m-look" class="input" type="number" min={1} max={180} style={{ maxWidth: 140 }} value={s.mail.lookbackDays} onChange={(e) => void saveSettings({ mail: { lookbackDays: Number((e.currentTarget as HTMLInputElement).value) } })} />
      </Field>
      <Field label="Always-important senders" id="m-snd" hint="Addresses or domains, e.g. a professor's email, admissions@university.edu, or a company domain.">
        <ChipsInput id="m-snd" values={s.mail.extraSenders} onChange={(v) => void saveSettings({ mail: { extraSenders: v } })} placeholder="admissions@mbzuai.ac.ae, kaust.edu.sa" />
      </Field>
      <Callout kind="plain">
        Built-in rules (from your Placement Tracker routine): GGSIPU placement cell and POD, Internshala, Naukri, LinkedIn application confirmations, applicant-tracking systems and coding-test platforms; plus universities, uni-assist, DAAD, IELTS/TOEFL, UPSC, SSC, NTA and IBPS. Job alerts, OTPs, newsletters and paid "training & internship programs" are ignored.
      </Callout>
    </section>
  );
}

function DataTab() {
  const [busy, setBusy] = useState('');
  const [confirmText, setConfirmText] = useState('');
  return (
    <div class="stack">
      <section class="card card-pad stack">
        <h3 style={{ fontSize: 15 }}>Your data</h3>
        <p class="small ink-2">Everything lives in a Google Sheet in your own Drive. You can open it, sort it, chart it, or share it; InternIQ keeps working with it.</p>
        <div class="row wrap">
          <ExtLink href={sheetUrl.value} class="btn">
            <FileSpreadsheet size={15} /> Open my sheet
          </ExtLink>
          <Button
            onClick={async () => {
              const csv = jobsToCsv(jobs.value);
              if (downloadText('interniq-all.csv', csv, 'text/csv')) toast('Exported all jobs');
              else if (await copyText(csv)) toast('Download blocked here, so the CSV was copied to your clipboard');
            }}
          >
            Export CSV
          </Button>
          <Button onClick={() => (addOpen.value = 'import')}>Import…</Button>
          <Button
            loading={busy === 'rescore'}
            onClick={async () => {
              setBusy('rescore');
              try {
                setJobs((await call('rescoreAll')).jobs);
                toast('Free scores recalculated for every job');
              } catch (e) {
                toastError(e);
              } finally {
                setBusy('');
              }
            }}
          >
            <RefreshCw size={15} /> Recalculate scores
          </Button>
        </div>
      </section>
      <section class="card card-pad stack">
        <div class="row">
          <ShieldCheck size={18} class="pos" />
          <h3 style={{ fontSize: 15 }}>How InternIQ handles your data</h3>
        </div>
        <ul class="small ink-2" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>The app runs as you, inside your Google account. The developer cannot see your jobs, profile or keys.</li>
          <li>Jobs, notes and cover letters are stored in your sheet; settings and API keys in your private Apps Script properties.</li>
          <li>Job sources are fetched from public APIs. AI providers receive only what you choose to analyse, with your own key.</li>
          <li>Emails go only to your own address, and only if you turn the digest on.</li>
        </ul>
      </section>
      <section class="card card-pad stack" style={{ borderColor: 'color-mix(in srgb, var(--critical) 35%, transparent)' }}>
        <h3 style={{ fontSize: 15 }}>Delete everything</h3>
        <p class="small ink-2">Erases all jobs, notes, cover letters, settings, API keys and scheduled refreshes. The empty spreadsheet stays in your Drive for you to trash.</p>
        <div class="row">
          <input class="input" style={{ maxWidth: 200 }} placeholder="Type DELETE" value={confirmText} onInput={(e) => setConfirmText((e.currentTarget as HTMLInputElement).value)} aria-label="Type DELETE to confirm" />
          <Button
            variant="danger"
            loading={busy === 'delete'}
            disabled={confirmText !== 'DELETE'}
            onClick={async () => {
              setBusy('delete');
              try {
                await call('deleteAllData', 'DELETE');
                remember('view', 'home');
                location.reload();
              } catch (e) {
                toastError(e);
                setBusy('');
              }
            }}
          >
            <Trash2 size={15} /> Delete all my data
          </Button>
        </div>
      </section>
      <p class="tiny muted">InternIQ v{version.value}</p>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('profile');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'ai', label: aiReady.value ? 'AI' : 'AI (off)' },
    { id: 'sources', label: 'Sources' },
    { id: 'automation', label: 'Automation' },
    { id: 'mail', label: 'Mail' },
    { id: 'data', label: 'Data & privacy' },
  ];
  return (
    <div style={{ maxWidth: 860 }}>
      <div class="settings-nav segmented" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'profile' ? <ProfileTab /> : null}
      {tab === 'ai' ? (
        <section class="card card-pad">
          <AiSetup />
        </section>
      ) : null}
      {tab === 'sources' ? <SourcesTab /> : null}
      {tab === 'automation' ? <AutomationTab /> : null}
      {tab === 'mail' ? <MailTab /> : null}
      {tab === 'data' ? <DataTab /> : null}
      {tab !== 'profile' ? (
        <p class="tiny muted" style={{ marginTop: 12 }}>
          Changes on this tab save as you make them.
        </p>
      ) : null}
    </div>
  );
}
