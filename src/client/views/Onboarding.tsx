import { useState } from 'preact/hooks';
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from 'lucide-preact';
import { SUGGESTED_BOARDS } from '../../shared/boards';
import { SIMPLIFY_CATEGORIES } from '../../shared/defaults';
import type { Board, Profile } from '../../shared/types';
import { call, errorText } from '../api';
import { applyBoot, profile, refreshNow, saveProfile, saveSettings, settings, toast } from '../state';
import { Button, Callout, Toggle } from '../ui';
import { AiSetup, ProfileForm } from './Settings';

const STEPS = ['Welcome', 'About you', 'AI', 'Sources', 'Done'] as const;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Profile>(profile.value!);
  const [categories, setCategories] = useState<string[]>(settings.value!.sources.simplify.categories);
  const [boards, setBoards] = useState<Board[]>(settings.value!.sources.boards);
  const [pack, setPack] = useState(true);
  const [daily, setDaily] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const s = settings.value!;

  const next = async () => {
    setError('');
    if (step === 1) {
      if (!draft.targetRoles.length) {
        setError('Add at least one target role so InternIQ knows what to look for.');
        return;
      }
      if (!(await saveProfile(draft))) return;
    }
    setStep(step + 1);
  };

  const finish = async () => {
    setError('');
    try {
      setStatus('Saving your preferences…');
      await saveSettings({
        sources: { simplify: { enabled: categories.length > 0, categories }, boards },
        automation: { enabled: daily, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || s.automation.timezone },
      });
      if (pack) {
        setStatus('Adding research programmes…');
        await call('importStarterPack');
      }
      setStatus('Fetching and scoring internships (this takes up to a minute)…');
      await call('completeOnboarding');
      await refreshNow();
      applyBoot(await call('bootstrap'));
      toast('You are all set. Strong matches are at the top of Discover.');
    } catch (e) {
      setError(errorText(e));
      setStatus('');
    }
  };

  const toggleBoard = (b: Board) => {
    const on = boards.some((x) => x.ats === b.ats && x.token === b.token);
    setBoards(on ? boards.filter((x) => !(x.ats === b.ats && x.token === b.token)) : [...boards, { ats: b.ats, token: b.token, name: b.name }]);
  };

  return (
    <div class="onboard">
      <div class="onboard-card">
        <div class="row">
          <div class="logo-mark" aria-hidden="true">
            IQ
          </div>
          <div>
            <div class="brand-name">InternIQ</div>
            <div class="brand-sub">Step {step + 1} of {STEPS.length}: {STEPS[step]}</div>
          </div>
        </div>
        <div class="steps" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span class={i <= step ? 'on' : ''} />
          ))}
        </div>

        <div class="card card-pad stack" style={{ gap: 18 }}>
          {step === 0 ? (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 700 }}>Find internships that actually fit you.</h2>
              <p class="ink-2">
                InternIQ pulls fresh internships from SimplifyJobs and the companies you follow, scores every one against your skills, goals and eligibility, and tracks your applications from saved to offer.
              </p>
              <ul class="points">
                {[
                  'Free match scores on every posting, with no key needed',
                  'Optional AI analysis and cover letters with a free Gemini or Groq key',
                  'Your data stays in a Google Sheet in your own Drive',
                  'Daily refresh and email digest, even with the tab closed',
                ].map((t) => (
                  <li>
                    <Check size={15} class="pos" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div>
                <h2 style={{ fontSize: 18 }}>Tell InternIQ about you</h2>
                <p class="small muted">Target roles are required; everything else sharpens your scores. You can change it all later.</p>
              </div>
              <ProfileForm value={draft} onChange={setDraft} />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div>
                <h2 style={{ fontSize: 18 }}>Pick your analysis engine</h2>
                <p class="small muted">The free matcher works on every job instantly. A free AI key adds written analysis, tips and cover letters for your best matches.</p>
              </div>
              <AiSetup compact />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div>
                <h2 style={{ fontSize: 18 }}>Where should we look?</h2>
                <p class="small muted">SimplifyJobs covers thousands of internships. Following companies adds their own boards with full descriptions.</p>
              </div>
              <div class="stack" style={{ gap: 8 }}>
                <span class="field-label">SimplifyJobs categories</span>
                <div class="row wrap" style={{ gap: 6 }}>
                  {SIMPLIFY_CATEGORIES.map((c) => (
                    <button type="button" class="chip" aria-pressed={categories.includes(c)} onClick={() => setCategories(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c])}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div class="stack" style={{ gap: 8 }}>
                <span class="field-label">Follow companies ({boards.length})</span>
                <div class="row wrap" style={{ gap: 6 }}>
                  {SUGGESTED_BOARDS.map((b) => (
                    <button type="button" class="chip" aria-pressed={boards.some((x) => x.ats === b.ats && x.token === b.token)} onClick={() => toggleBoard(b)}>
                      {b.name}
                    </button>
                  ))}
                </div>
                <span class="tiny muted">Add any other company later in Settings → Sources.</span>
              </div>
              <Toggle checked={pack} onChange={setPack} label="Add 32 research programmes" hint="ETH SSRF, Mitacs, MBZUAI, IISc, IIT fellowships, MSR India and more, with official links." />
              <Toggle checked={daily} onChange={setDaily} label="Refresh automatically every morning" hint="Runs in your Google account; you can change the time later." />
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h2 style={{ fontSize: 18 }}>Ready</h2>
              <p class="ink-2">
                InternIQ will create your tracker sheet, fetch the latest internships{categories.length ? ` (${categories.join(', ')})` : ''}
                {boards.length ? ` plus ${boards.length} compan${boards.length === 1 ? 'y' : 'ies'}` : ''}, and score them against your profile.
              </p>
              {status ? (
                <div class="row ink-2">
                  <LoaderCircle size={16} class="spin" /> {status}
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <Callout kind="error">{error}</Callout> : null}

          <div class="row">
            {step > 0 && !status ? (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={15} /> Back
              </Button>
            ) : null}
            <span class="spacer" />
            {step < 4 ? (
              <Button variant="primary" onClick={() => void next()}>
                {step === 0 ? 'Get started' : 'Continue'} <ArrowRight size={15} />
              </Button>
            ) : (
              <Button variant="primary" loading={Boolean(status)} onClick={() => void finish()}>
                Start finding internships
              </Button>
            )}
          </div>
        </div>
        <p class="tiny muted" style={{ textAlign: 'center', marginTop: 14 }}>
          Signed in with Google. InternIQ opens only its own tracker sheet (and any sheet you choose to import), emails only you, and fetches public job listings.
        </p>
      </div>
    </div>
  );
}
