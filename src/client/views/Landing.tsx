/**
 * The signed-out page: what InternIQ is, how it treats your data, and one
 * button to sign in with Google.
 */
import { useState } from 'preact/hooks';
import { CalendarDays, Compass, GraduationCap, Inbox, Landmark, LockKeyhole, Sparkles, SquareKanban } from 'lucide-preact';
import { authError, signInWithGoogle } from '../auth';
import { CONFIG, configured } from '../config';
import { Button, Callout } from '../ui';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const SAMPLE = [
  { area: 'internships', when: 'Tue 24', title: 'ML Intern · Northwind AI', note: 'Applications close 11:59 PM' },
  { area: 'studies', when: 'Fri 27', title: 'MSc NLP · MBZUAI', note: 'Statement of purpose due' },
  { area: 'exams', when: 'Mon 30', title: 'SSC CGL', note: 'Registration window opens' },
  { area: 'internships', when: 'Dec 2', title: 'Interview · Kestrel Maps', note: '3:30 PM, Google Meet' },
] as const;

const FEATURES = [
  { Icon: Compass, title: 'Internships, found for you', text: 'Fresh postings from SimplifyJobs and the company boards you follow, scored against your skills, goals and eligibility. Free, no key needed.' },
  { Icon: SquareKanban, title: 'A pipeline you will actually keep', text: 'Saved, applied, interviewing, offer: drag cards along, add notes and follow-ups, and see where your applications stand at a glance.' },
  { Icon: GraduationCap, title: 'Further studies, planned', text: 'A researched list of funded master’s and PhD programmes and research internships abroad, with deadlines, requirements and a document checklist.' },
  { Icon: Landmark, title: 'Government exams, on the radar', text: 'UPSC, SSC, GATE, DSSSB, banking and more, with expected dates and eligibility notes for your branch and year.' },
  { Icon: Inbox, title: 'Your inbox, triaged', text: 'Optional: connect Gmail read-only and InternIQ turns placement, admissions and exam emails into application updates and dated tasks.' },
  { Icon: CalendarDays, title: 'One calendar for all of it', text: 'Every deadline, interview and exam date in one place, with a private feed you can subscribe to in Google or Apple Calendar.' },
];

export function Landing() {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    await signInWithGoogle();
    setBusy(false);
  };
  const cta = (
    <Button variant="primary" class="landing-cta" loading={busy} disabled={!configured} onClick={() => void start()}>
      {busy ? null : <GoogleMark />} Continue with Google
    </Button>
  );
  return (
    <div class="landing">
      <header class="landing-top">
        <div class="brand">
          <div class="logo-mark" aria-hidden="true">
            IQ
          </div>
          <div class="brand-name">InternIQ</div>
        </div>
        <span class="spacer" />
        <Button size="sm" onClick={() => void start()} disabled={!configured}>
          Sign in
        </Button>
      </header>

      <main>
        <section class="landing-hero">
          <div class="landing-copy">
            <p class="landing-kicker">
              <Sparkles size={14} /> Free for students
            </p>
            <h1>Internships, higher studies and government exams. One tracker.</h1>
            <p class="landing-lede">
              InternIQ finds internships that fit you, keeps every application moving, and puts each deadline (applications, SOPs, exam forms, interviews) on one calendar. Built by a student, for batchmates and juniors.
            </p>
            {!configured ? <Callout kind="warn">This copy of InternIQ is not connected to a server yet. If you deployed it, finish the setup in docs/DEPLOY.md.</Callout> : null}
            {authError.value ? <Callout kind="error">Sign-in did not finish: {authError.value}</Callout> : null}
            <div class="row wrap" style={{ gap: 12 }}>
              {cta}
              <span class="small muted">Uses your Google account. No password to remember.</span>
            </div>
          </div>
          <div class="landing-preview card" aria-label="Example of the week view">
            <div class="row small" style={{ marginBottom: 10 }}>
              <strong>This week</strong>
              <span class="spacer" />
              <span class="muted">4 things due</span>
            </div>
            <ul class="landing-agenda">
              {SAMPLE.map((s) => (
                <li class={`landing-ev area-${s.area}`}>
                  <span class="landing-when">{s.when}</span>
                  <span>
                    <span class="landing-ev-title">{s.title}</span>
                    <span class="landing-ev-note">{s.note}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div class="row tiny muted" style={{ gap: 14, marginTop: 12 }}>
              <span class="row" style={{ gap: 6 }}>
                <span class="area-dot internships" /> Internships
              </span>
              <span class="row" style={{ gap: 6 }}>
                <span class="area-dot studies" /> Studies
              </span>
              <span class="row" style={{ gap: 6 }}>
                <span class="area-dot exams" /> Exams
              </span>
            </div>
          </div>
        </section>

        <section class="landing-grid" aria-label="Features">
          {FEATURES.map(({ Icon, title, text }) => (
            <article class="landing-feature">
              <Icon size={20} />
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </section>

        <section class="landing-privacy card card-pad">
          <div class="row" style={{ gap: 10 }}>
            <LockKeyhole size={18} />
            <h2>Your data stays yours</h2>
          </div>
          <ul>
            <li>Each account can only ever read its own rows: the database enforces it, not just the app.</li>
            <li>AI is optional and uses your own free Gemini or Groq key, stored encrypted. Without one, scoring still works.</li>
            <li>Gmail access is optional, read-only, and can be disconnected any time. Only short extracts are kept, never whole emails.</li>
            <li>Export everything as a file, or delete your account and all its data, from Settings.</li>
          </ul>
        </section>

        <section class="landing-final">
          <h2>Ready when you are.</h2>
          {cta}
        </section>
      </main>

      <footer class="landing-foot">
        <span>InternIQ{CONFIG.operator ? ` · run by ${CONFIG.operator}` : ''}</span>
        <span class="spacer" />
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
        <a href="https://github.com/DhruvBasia/internship-intelligence-platform" target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </footer>
    </div>
  );
}
