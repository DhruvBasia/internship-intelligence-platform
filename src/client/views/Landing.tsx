/**
 * The signed-out page ("Night shift"): a dark launch page with the product
 * front and centre, what it does, how it treats your data, and one button to
 * sign in with Google. The example screens use dates relative to today so
 * the page never looks stale.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ArrowDown, ArrowRight, ChevronDown, Download, KeyRound, LoaderCircle, LockKeyhole, Mail } from 'lucide-preact';
import { authError, signInWithGoogle } from '../auth';
import { CONFIG, configured } from '../config';
import { Callout } from '../ui';

const SOURCE_URL = 'https://github.com/DhruvBasia/internship-intelligence-platform';

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

/* ---------- example dates, relative to today ---------- */

const DAY = 86_400_000;
function today(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}
const plus = (base: Date, n: number) => new Date(base.getTime() + n * DAY);
/** The nth working day after base (Mon to Fri), so no example interview lands on a Sunday. */
function workday(base: Date, n: number): Date {
  let d = base;
  for (let left = n; left > 0; ) {
    d = plus(d, 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}
const dayNum = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }); // "Tue 24"
const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' }); // "Tue"
const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); // "26 Nov"
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); // "26 November"

type Area = 'jobs' | 'study' | 'exam';
/** The four example events, as working days from today. */
const EVENTS: { at: number; area: Area; title: string; note: string; warn?: boolean }[] = [
  { at: 1, area: 'jobs', title: 'ML Intern · Northwind AI', note: 'closes 23:59', warn: true },
  { at: 2, area: 'jobs', title: 'Interview · Kestrel Maps', note: '15:30 Meet' },
  { at: 4, area: 'study', title: 'SOP · MBZUAI MSc NLP', note: 'draft 2 of 3' },
  { at: 6, area: 'exam', title: 'SSC CGL registration opens', note: 'reminder set' },
];
const eventDay = (now: Date, at: number) => workday(now, at);

/* ---------- small pieces ---------- */

function useSignIn() {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    await signInWithGoogle();
    setBusy(false);
  };
  return { busy, start };
}

function GoogleButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" class="lp-google" onClick={onClick} disabled={!configured || busy} aria-busy={busy ? 'true' : undefined}>
      {busy ? <LoaderCircle size={18} class="spin" aria-hidden="true" /> : <GoogleMark />}
      Continue with Google
    </button>
  );
}

/** In-page link that scrolls without touching the hash (the hash is the app's router). */
function JumpLink({ to, class: cls, children }: { to: string; class?: string; children: ComponentChildren }) {
  return (
    <a
      href={`#${to}`}
      class={cls}
      onClick={(e) => {
        e.preventDefault();
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(to)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }}
    >
      {children}
    </a>
  );
}

function Logo({ small }: { small?: boolean }) {
  return (
    <span class={`lp-logo${small ? ' sm' : ''}`} aria-hidden="true">
      iq
    </span>
  );
}

/* ---------- the tilted product shot ---------- */

function ProductShot({ now }: { now: Date }) {
  const nav: [string, string?][] = [['Today'], ['Internships', '31'], ['Pipeline'], ['Calendar'], ['Mail', '2'], ['Studies'], ['Exams']];
  return (
    <div class="lp-shot" role="img" aria-label="Example of the InternIQ Today screen: four stats, the next four deadlines and two emails that need attention">
      <div class="lp-shot-tilt">
        <div class="lp-app" aria-hidden="true">
          <div class="lp-app-side">
            <div class="lp-app-brand">
              <Logo small />
              InternIQ
            </div>
            {nav.map(([label, count], i) => (
              <div class={`lp-app-nav${i === 0 ? ' on' : ''}`}>
                <span>{label}</span>
                {count ? <span class={`lp-mono${label === 'Mail' ? ' lp-accent' : ''}`}>{count}</span> : null}
              </div>
            ))}
          </div>
          <div class="lp-app-main">
            <div class="lp-app-head">
              <span class="lp-app-title">Today</span>
              <span class="lp-mono lp-dim">{now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span class="lp-grow" />
              <span class="lp-app-search">
                Search<span class="lp-grow" />
                <span class="lp-mono">Ctrl K</span>
              </span>
            </div>
            <div class="lp-app-stats">
              {[
                ['Applied', '9'],
                ['Interviewing', '2'],
                ['Saved', '4'],
                ['New matches', '31'],
              ].map(([k, v], i) => (
                <div>
                  <div class="lp-dim">{k}</div>
                  <div class={`lp-mono lp-stat${i === 3 ? ' lp-accent' : ''}`}>{v}</div>
                </div>
              ))}
            </div>
            <div class="lp-app-cols">
              <div class="lp-app-card">
                <div class="lp-app-card-h">Up next</div>
                {EVENTS.map((e) => (
                  <div class="lp-app-row">
                    <span class="lp-mono lp-when">{dayNum(eventDay(now, e.at))}</span>
                    <span class={`lp-dot lp-${e.area}`} />
                    <span class="lp-grow lp-clip">{e.title}</span>
                    <span class={e.warn ? 'lp-warn' : 'lp-soft'}>{e.note}</span>
                  </div>
                ))}
              </div>
              <div class="lp-app-card">
                <div class="lp-app-card-h">Needs attention</div>
                <div class="lp-app-mail">
                  <div class="lp-app-mail-top">
                    <strong>Kestrel Maps</strong>
                    <span class="lp-tag">Interview</span>
                  </div>
                  <div class="lp-dim">Interview invitation, Backend Intern</div>
                </div>
                <div class="lp-app-mail">
                  <div class="lp-app-mail-top">
                    <strong>Orbit Pay</strong>
                    <span class="lp-tag">Assessment</span>
                  </div>
                  <div class="lp-dim">Your online assessment link</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="lp-shot-fade" aria-hidden="true" />
    </div>
  );
}

/* ---------- feature tiles ---------- */

function Tile({ title, text, span, children }: { title: string; text: string; span: 4 | 5 | 7; children: ComponentChildren }) {
  return (
    <article class={`lp-tile s${span}`}>
      <div class="lp-tile-text">
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div class="lp-tile-visual" aria-hidden="true">
        {children}
      </div>
    </article>
  );
}

const MATCHES = [
  { role: 'ML Intern', meta: 'Northwind AI · Bengaluru · Python, PyTorch', score: 94 },
  { role: 'Backend Intern', meta: 'Kestrel Maps · Remote · Go, SQL', score: 88 },
  { role: 'Data Analyst Intern', meta: 'Lumen Labs · Pune · SQL, Excel', score: 81 },
];

const BOARD: { name: string; cards: string[]; tone?: 'live' | 'won' }[] = [
  { name: 'Saved', cards: ['Lumen', 'Vela'] },
  { name: 'Applied', cards: ['Northwind', 'Atlas', 'Quill'] },
  { name: 'Interview', cards: ['Kestrel', 'Orbit'], tone: 'live' },
  { name: 'Offer', cards: ['Fernwood'], tone: 'won' },
];
const BOARD_COUNTS = [4, 9, 2, 1];

function Calendar({ now }: { now: Date }) {
  const monday = plus(now, -((now.getDay() + 6) % 7));
  const marks = new Map<string, Area>();
  for (const e of EVENTS) marks.set(eventDay(now, e.at).toDateString(), e.area);
  const cells = Array.from({ length: 14 }, (_, i) => plus(monday, i));
  return (
    <div class="lp-cal">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => (
        <span class="lp-cal-dow">{d}</span>
      ))}
      {cells.map((d) => {
        const isToday = d.toDateString() === now.toDateString();
        const area = marks.get(d.toDateString());
        const past = d < now && !isToday;
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        return (
          <span class={`lp-cal-day${isToday ? ' today' : ''}${past || weekend ? ' quiet' : ''}`}>
            {d.getDate()}
            {area ? <span class={`lp-dot lp-${area}`} /> : null}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- page ---------- */

export function Landing() {
  const { busy, start } = useSignIn();
  const now = today();
  const interview = eventDay(now, EVENTS[1]!.at);
  const sop = eventDay(now, EVENTS[2]!.at);
  const ssc = eventDay(now, EVENTS[3]!.at);

  // The page is always dark: paint the whole document (overscroll, address bar) to match.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('lp-on');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const before = meta?.content;
    if (meta) meta.content = '#08090c';
    return () => {
      root.classList.remove('lp-on');
      if (meta && before) meta.content = before;
    };
  }, []);

  const signIn = () => void start();

  return (
    <div class="lp" id="lp-top">
      <div class="lp-grid-bg" aria-hidden="true" />
      <header class="lp-wrap lp-nav">
        <JumpLink to="lp-top" class="lp-brand">
          <Logo />
          <span>InternIQ</span>
        </JumpLink>
        <nav aria-label="Page" class="lp-links">
          <JumpLink to="features">Features</JumpLink>
          <JumpLink to="privacy">Privacy</JumpLink>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Source
          </a>
        </nav>
        <button type="button" class="lp-signin" onClick={signIn} disabled={!configured || busy}>
          Sign in
        </button>
      </header>

      <main>
        <section class="lp-wrap lp-hero" aria-labelledby="lp-title">
          <JumpLink to="features" class="lp-pill">
            <span class="lp-pill-dot" aria-hidden="true" />
            Free for students, open source
            <span class="lp-pill-go" aria-hidden="true">
              <ArrowRight size={12} strokeWidth={2.5} />
            </span>
          </JumpLink>
          <h1 id="lp-title">
            Placement season,
            <br />
            <span>finally under control.</span>
          </h1>
          <p class="lp-lede">InternIQ finds internships that fit you, keeps every application on one board, and puts every deadline (SOPs, exam forms, interviews) on one calendar.</p>
          {!configured ? (
            <div class="lp-callout">
              <Callout kind="warn">This copy of InternIQ is not connected to a server yet. If you deployed it, finish the setup in docs/DEPLOY.md.</Callout>
            </div>
          ) : null}
          {authError.value ? (
            <div class="lp-callout">
              <Callout kind="error">Sign-in did not finish: {authError.value}</Callout>
            </div>
          ) : null}
          <div class="lp-cta-row">
            <GoogleButton busy={busy} onClick={signIn} />
            <JumpLink to="features" class="lp-ghost">
              See what's inside
              <ChevronDown size={15} strokeWidth={2.5} aria-hidden="true" />
            </JumpLink>
          </div>
          <p class="lp-fine">No password. Gmail access is optional and read-only.</p>
        </section>

        <div class="lp-wrap">
          <ProductShot now={now} />
        </div>

        <section id="features" class="lp-wrap lp-section" aria-labelledby="lp-features">
          <p class="lp-eyebrow">What it does</p>
          <h2 id="lp-features">Built for how students actually apply.</h2>
          <p class="lp-sub">Not another spreadsheet. InternIQ does the sorting so you can spend the time applying.</p>

          <div class="lp-bento">
            <Tile span={7} title="Matches, scored for you" text="Fresh internships every day from SimplifyJobs and the boards you follow, ranked against your skills, year and eligibility.">
              <div class="lp-inset lp-matches">
                {MATCHES.map((m, i) => (
                  <div class="lp-match">
                    <div class="lp-clip-wrap">
                      <div class="lp-match-role">{m.role}</div>
                      <div class="lp-dim lp-clip">{m.meta}</div>
                    </div>
                    <div class="lp-bar">
                      <span style={{ width: `${m.score}%` }} class={i === 2 ? 'lo' : ''} />
                    </div>
                    <span class="lp-mono lp-score">{m.score}</span>
                  </div>
                ))}
              </div>
            </Tile>

            <Tile span={5} title="Your inbox, triaged" text="Connect Gmail read-only. Placement, admissions and exam emails become updates and dated tasks.">
              <div class="lp-inset lp-email">
                <div class="lp-email-from">
                  <span class="lp-avatar">K</span>
                  <div class="lp-clip-wrap">
                    <div class="lp-email-name">Kestrel Maps Talent</div>
                    <div class="lp-dim">Interview invitation, Backend Intern</div>
                  </div>
                </div>
                <p>
                  We'd like to invite you to a technical interview on {longDate(interview)} at 3:30 PM on Google Meet.
                </p>
              </div>
              <div class="lp-arrow">
                <ArrowDown size={18} />
              </div>
              <div class="lp-chips">
                <span class="lp-chip accent">Moved to Interviewing</span>
                <span class="lp-chip">Task: interview, {dayMonth(interview)} 15:30</span>
                <span class="lp-chip">On your calendar</span>
              </div>
            </Tile>

            <Tile span={4} title="One board" text="Saved, applied, interviewing, offer. Notes and follow-ups on every card.">
              <div class="lp-board">
                {BOARD.map((col, i) => (
                  <div class="lp-board-col">
                    <div class="lp-board-h">
                      <span>{col.name}</span>
                      <span class="lp-mono">{BOARD_COUNTS[i]}</span>
                    </div>
                    {col.cards.map((c, j) => (
                      <div class={`lp-board-card${j === 0 && col.tone ? ` ${col.tone}` : ''}`}>{c}</div>
                    ))}
                  </div>
                ))}
              </div>
            </Tile>

            <Tile span={4} title="One calendar" text="Every deadline in one place, with a private feed for Google or Apple Calendar.">
              <Calendar now={now} />
            </Tile>

            <Tile span={4} title="Master's and exams, planned" text="Funded programmes abroad, plus UPSC, SSC, GATE and banking dates for your branch.">
              <div class="lp-list">
                <div class="lp-list-row">
                  <span class="lp-sq lp-study" />
                  <span class="lp-grow">MSc NLP · MBZUAI</span>
                  <span class="lp-mono lp-soft">SOP {weekday(sop)}</span>
                </div>
                <div class="lp-list-row">
                  <span class="lp-sq lp-exam" />
                  <span class="lp-grow">GATE CS 2027</span>
                  <span class="lp-mono lp-soft">Feb 2027</span>
                </div>
                <div class="lp-list-row">
                  <span class="lp-sq lp-exam" />
                  <span class="lp-grow">SSC CGL</span>
                  <span class="lp-mono lp-soft">opens {dayNum(ssc)}</span>
                </div>
              </div>
            </Tile>
          </div>
        </section>

        <section id="privacy" class="lp-wrap lp-section lp-privacy" aria-labelledby="lp-privacy">
          <div class="lp-privacy-intro">
            <p class="lp-eyebrow">Privacy</p>
            <h2 id="lp-privacy">Private by default.</h2>
            <p class="lp-sub">It's built to be shared with batchmates, so it had to be safe to share.</p>
          </div>
          <div class="lp-privacy-grid">
            <div>
              <LockKeyhole size={20} aria-hidden="true" />
              <h3>Only you see your rows</h3>
              <p>The database itself blocks every other account, not just the app.</p>
            </div>
            <div>
              <Mail size={20} aria-hidden="true" />
              <h3>Gmail is optional</h3>
              <p>Read-only, short extracts only, and you can disconnect it in one click.</p>
            </div>
            <div>
              <KeyRound size={20} aria-hidden="true" />
              <h3>Your own AI key, if any</h3>
              <p>Add a free Gemini or Groq key, stored encrypted. Scoring works without one.</p>
            </div>
            <div>
              <Download size={20} aria-hidden="true" />
              <h3>Leave any time</h3>
              <p>Export everything as a file, or delete your account and all its data.</p>
            </div>
          </div>
        </section>

        <section class="lp-wrap lp-section" aria-labelledby="lp-final">
          <div class="lp-final">
            <h2 id="lp-final">Start before the next drive.</h2>
            <p>Sign in with Google. It takes one click.</p>
            <GoogleButton busy={busy} onClick={signIn} />
          </div>
        </section>
      </main>

      <footer class="lp-wrap lp-foot">
        <span class="lp-grow">InternIQ{CONFIG.operator ? ` · run by ${CONFIG.operator}` : ''}</span>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
