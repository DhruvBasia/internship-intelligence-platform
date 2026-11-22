/**
 * Home ("Night shift command centre"): what needs you first, then the numbers,
 * top matches, the next two weeks, the inbox and the longer-term plans.
 */
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ArrowRight, Bookmark, BookmarkCheck, Check, Clock, Compass, FileText, GraduationCap, Landmark, MessageSquare, RefreshCw, TriangleAlert, Video } from 'lucide-preact';
import type { CalEvent } from '../../shared/calendar';
import { DOC_KEYS, DOC_LABELS, STAGE_LABELS, type JobSummary, type MailItem, type Stage, type Task } from '../../shared/types';
import { daysUntil, dueLabel, greeting, plural, relTime, todayDay, verdictOf } from '../lib/format';
import {
  activity,
  aiReady,
  counts,
  exams,
  features,
  jobs,
  jobsById,
  lastMailScan,
  lastRefresh,
  mail,
  mailAction,
  moveJob,
  navigate,
  openJobId,
  profile,
  programs,
  refreshNow,
  refreshing,
  remember,
  setFilters,
  tasks,
  toggleTask,
  usage,
} from '../state';
import { Button, Callout, Empty, ExtLink, ScoreRing } from '../ui';
import { AreaDot, openEvent, useEvents } from './Calendar';
import { feedbackOpen } from './Feedback';

const DAY = 86_400_000;

/* ---------- small date helpers (local time) ---------- */

const asDate = (day: string) => new Date(day.slice(0, 10) + 'T12:00:00');
const dayShort = (day: string) => asDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }); // "Fri 20"
const dayLong = (day: string) => asDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); // "Mon 23 Nov"
function timeLabel(hhmm: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
}
function whenWords(day: string): string {
  const n = daysUntil(day);
  if (Number.isNaN(n)) return '';
  if (n < 0) return `${-n}d overdue`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const MODE_LABEL: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
function jobMeta(j: JobSummary): string {
  const mode = MODE_LABEL[j.workMode] ?? '';
  const loc = j.location.replace(/\s*;\s*/g, ', ');
  return [j.company, loc, mode && !new RegExp(mode.replace('-', '.?'), 'i').test(loc) ? mode : ''].filter(Boolean).join(' · ');
}

function skillLine(j: JobSummary): string {
  const have = j.match?.matchedSkills ?? [];
  const miss = j.match?.missingSkills ?? [];
  if (have.length) {
    const a = `Matches ${listJoin(have.slice(0, 3))} from your profile.`;
    return miss.length ? `${a} Missing ${listJoin(miss.slice(0, 2))}.` : a;
  }
  return j.match?.summary || j.snippet || '';
}

/* ---------- "Needs you" ---------- */

type Tone = 'warn' | 'accent' | 'orange' | 'critical' | 'studies' | 'exams' | 'neutral';
interface Action {
  label: string;
  primary?: boolean;
  href?: string;
  run?: () => void;
}
interface Need {
  key: string;
  date: string;
  time: string;
  tone: Tone;
  icon: 'clock' | 'video' | 'file' | 'alert' | 'cap' | 'landmark';
  label: string;
  corner: string;
  cornerAccent?: boolean;
  title: string;
  sub: string;
  note: string;
  actions: Action[];
}

/** Everything time-bound in the next few days, soonest first (overdue on top). */
function buildNeeds(): Need[] {
  const out: Need[] = [];
  const mailById = new Map(mail.value.map((m) => [m.id, m] as const));

  for (const j of jobs.value) {
    if (!j.deadline || (j.stage !== 'discovered' && j.stage !== 'saved')) continue;
    const n = daysUntil(j.deadline);
    if (n < 0 || n > 3) continue;
    out.push({
      key: 'apply:' + j.id,
      date: j.deadline,
      time: '23:59',
      tone: 'warn',
      icon: 'clock',
      label: n === 0 ? 'Closes today' : n === 1 ? 'Closes tomorrow' : `Closes ${dayShort(j.deadline)}`,
      corner: String(j.score),
      cornerAccent: true,
      title: j.role,
      sub: jobMeta(j),
      note: skillLine(j),
      actions: [
        ...(j.url ? [{ label: 'Apply now', primary: true, href: j.url }] : []),
        { label: 'Mark applied', run: () => void moveJob(j.id, 'applied') },
      ],
    });
  }

  for (const t of tasks.value) {
    if (t.status === 'done' || !t.due) continue;
    const day = t.due.slice(0, 10);
    const n = daysUntil(day);
    if (n > 7) continue;
    const m = t.mailId ? mailById.get(t.mailId) : undefined;
    const time = t.due.length > 10 ? t.due.slice(11, 16) : '';
    const at = `${dayLong(day)}${time ? `, ${timeLabel(time)}` : ''}`;
    const isInterview = m?.category === 'interview' || /interview/i.test(t.title);
    const isTest = m?.category === 'assessment' || /assessment|online test|\boa\b/i.test(t.title);
    const tone: Tone = n < 0 ? 'critical' : isInterview ? 'accent' : isTest ? 'orange' : t.area === 'studies' ? 'studies' : t.area === 'exams' ? 'exams' : 'neutral';
    const link = m?.url || t.link;
    out.push({
      key: 'task:' + t.id,
      date: day,
      time,
      tone,
      icon: n < 0 ? 'alert' : isInterview ? 'video' : t.area === 'studies' ? 'cap' : t.area === 'exams' ? 'landmark' : 'file',
      label: n < 0 ? `Overdue since ${dayShort(day)}` : isInterview ? `Interview, ${at}` : isTest ? `Assessment due ${dayShort(day)}` : `Due ${n === 0 ? 'today' : dayShort(day)}`,
      corner: whenWords(day),
      title: t.title,
      sub: m ? [m.company || m.fromName, m.role].filter(Boolean).join(' · ') : t.source === 'roadmap' ? 'From your roadmap' : 'Your task',
      note: t.notes || (m ? `Picked up from ${m.fromName || m.company}'s email${m.date ? ` on ${dayShort(m.date)}` : ''}.` : ''),
      actions: [...(link ? [{ label: /mail\.google/.test(link) ? 'Open the email' : 'Open the link', href: link }] : []), { label: 'Mark done', run: () => void toggleTask(t) }],
    });
  }

  for (const j of jobs.value) {
    if (!j.followUpAt || (j.stage !== 'applied' && j.stage !== 'interviewing')) continue;
    const n = daysUntil(j.followUpAt);
    if (n > 1) continue;
    out.push({
      key: 'follow:' + j.id,
      date: j.followUpAt,
      time: '',
      tone: n < 0 ? 'critical' : 'neutral',
      icon: n < 0 ? 'alert' : 'clock',
      label: n < 0 ? `Follow-up ${-n}d overdue` : n === 0 ? 'Follow up today' : 'Follow up tomorrow',
      corner: whenWords(j.followUpAt),
      title: `Follow up with ${j.company}`,
      sub: j.role,
      note: j.appliedAt ? `You applied ${relTime(j.appliedAt)}.` : '',
      actions: [{ label: 'Open application', run: () => (openJobId.value = j.id) }],
    });
  }

  for (const p of programs.value) {
    if (!p.deadline || p.fit === 'skip' || ['applied', 'admitted', 'rejected', 'dropped'].includes(p.stage)) continue;
    const n = daysUntil(p.deadline);
    if (n < 0 || n > 10) continue;
    const tracked = DOC_KEYS.filter((k) => p.docs[k] && p.docs[k] !== 'na');
    const ready = tracked.filter((k) => p.docs[k] === 'done').length;
    out.push({
      key: 'program:' + p.id,
      date: p.deadline,
      time: '',
      tone: 'studies',
      icon: 'cap',
      label: `Deadline ${dayLong(p.deadline)}`,
      corner: whenWords(p.deadline),
      title: p.name,
      sub: p.org,
      note: tracked.length ? `${ready} of ${tracked.length} documents ready.` : 'Add your document checklist on the Further studies page.',
      actions: [{ label: 'Open in Further studies', run: () => navigate('studies') }],
    });
  }

  for (const x of exams.value) {
    if (x.stage === 'dropped') continue;
    for (const e of x.events) {
      if (e.precision !== 'day' || !e.date) continue;
      const n = daysUntil(e.date);
      if (n < 0 || n > 7) continue;
      out.push({
        key: `exam:${x.id}:${e.label}`,
        date: e.date,
        time: '',
        tone: 'exams',
        icon: 'landmark',
        label: `${e.label}, ${dayLong(e.date)}`,
        corner: whenWords(e.date),
        title: x.name.replace(/\s*\(.*\)$/, ''),
        sub: x.body,
        note: x.forYouNote,
        actions: [{ label: 'Open in Govt exams', run: () => navigate('exams') }],
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
}

const NEED_ICON = {
  clock: Clock,
  video: Video,
  file: FileText,
  alert: TriangleAlert,
  cap: GraduationCap,
  landmark: Landmark,
};

function NeedCard({ n }: { n: Need }) {
  const Icon = NEED_ICON[n.icon];
  return (
    <article class={`hm-need tone-${n.tone}`}>
      <div class="hm-need-top">
        <span class="hm-pill">
          <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
          {n.label}
        </span>
        <span class={`hm-need-corner${n.cornerAccent ? ' accent' : ''}`}>{n.cornerAccent ? <span class="sr-only">Match score </span> : null}{n.corner}</span>
      </div>
      <div>
        <h3 class="hm-need-title">{n.title}</h3>
        {n.sub ? <div class="hm-need-sub">{n.sub}</div> : null}
      </div>
      {n.note ? <p class="hm-need-note">{n.note}</p> : null}
      <div class="hm-need-actions">
        {n.actions.map((a) =>
          a.href ? (
            <ExtLink href={a.href} class={`btn sm${a.primary ? ' primary' : ''}`}>
              {a.label}
            </ExtLink>
          ) : (
            <Button size="sm" variant={a.primary ? 'primary' : 'default'} onClick={a.run}>
              {a.label}
            </Button>
          ),
        )}
      </div>
    </article>
  );
}

/* ---------- numbers ---------- */

function Stat({ label, value, foot, tone, onClick, children }: { label: string; value: number; foot: string; tone?: 'accent' | 'good'; onClick: () => void; children?: ComponentChildren }) {
  return (
    <button type="button" class="hm-stat" onClick={onClick}>
      <span class="hm-stat-label">{label}</span>
      <span class="hm-stat-row">
        <span class={`hm-stat-value${tone ? ' ' + tone : ''}`}>{value.toLocaleString()}</span>
        {children}
      </span>
      <span class="hm-stat-foot">{foot}</span>
    </button>
  );
}

/** Postings added on each of the last 7 days (oldest first). */
function lastSevenDays(list: JobSummary[]): number[] {
  const bins = new Array(7).fill(0) as number[];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const origin = start.getTime() - 6 * DAY;
  for (const j of list) {
    const t = Date.parse(j.createdAt);
    if (Number.isNaN(t) || t < origin) continue;
    const i = Math.min(6, Math.floor((t - origin) / DAY));
    bins[i]++;
  }
  return bins;
}

/* ---------- top matches ---------- */

type MatchTab = 'top' | 'new' | 'closing';
function readTab(): MatchTab {
  try {
    const raw = JSON.parse(localStorage.getItem('iip.homeTab') ?? '"top"');
    return raw === 'new' || raw === 'closing' ? raw : 'top';
  } catch {
    return 'top';
  }
}

function MatchRow({ j, tab }: { j: JobSummary; tab: MatchTab }) {
  const have = j.match?.matchedSkills ?? [];
  const miss = j.match?.missingSkills ?? [];
  const closeIn = j.deadline ? daysUntil(j.deadline) : NaN;
  const right =
    j.deadline && (tab === 'closing' || (closeIn >= 0 && closeIn <= 3))
      ? { text: closeIn === 0 ? 'closes today' : `closes ${dueLabel(j.deadline)}`, warn: closeIn <= 2 }
      : { text: `posted ${relTime(j.postedAt || j.createdAt)}`, warn: false };
  const saved = j.stage !== 'discovered';
  return (
    <div class="hm-match">
      <button type="button" class="hm-match-main" onClick={() => (openJobId.value = j.id)} aria-label={`${j.role} at ${j.company}, score ${j.score}. Open details`}>
        <ScoreRing score={j.score} verdict={verdictOf(j)} size={40} />
        <span class="hm-match-text">
          <span class="hm-match-role">{j.role}</span>
          <span class="hm-match-meta">{jobMeta(j)}</span>
        </span>
        <span class="hm-chips" aria-hidden="true">
          {have.slice(0, 2).map((s) => (
            <span class="hm-chip">{s}</span>
          ))}
          {miss.slice(0, 1).map((s) => (
            <span class="hm-chip missing">{s}</span>
          ))}
        </span>
        <span class={`hm-match-when${right.warn ? ' warn' : ''}`}>{right.text}</span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        icon
        disabled={saved}
        onClick={() => void moveJob(j.id, 'saved')}
        aria-label={saved ? `${j.role} at ${j.company} is in your pipeline` : `Save ${j.role} at ${j.company}`}
        title={saved ? `In ${STAGE_LABELS[j.stage]}` : 'Save to pipeline'}
      >
        {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
      </Button>
    </div>
  );
}

function TopMatches() {
  const [tab, setTab] = useState<MatchTab>(readTab);
  const all = jobs.value;
  const lists = useMemo(() => {
    const open = all.filter((j) => j.stage === 'discovered');
    const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
    const today = todayDay();
    return {
      top: open.slice().sort((a, b) => b.score - a.score),
      new: open.filter((j) => j.createdAt > weekAgo).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.score - a.score),
      closing: all
        .filter((j) => (j.stage === 'discovered' || j.stage === 'saved') && j.deadline && j.deadline >= today && daysUntil(j.deadline) <= 14)
        .sort((a, b) => a.deadline.localeCompare(b.deadline) || b.score - a.score),
    };
  }, [all]);
  const pick = (t: MatchTab) => {
    setTab(t);
    remember('homeTab', t);
  };
  const rows = lists[tab].slice(0, 6);
  const anyChips = rows.some((j) => (j.match?.matchedSkills?.length ?? 0) + (j.match?.missingSkills?.length ?? 0) > 0);
  const seeAll = () => {
    if (tab === 'closing') setFilters({ stages: ['discovered', 'saved'], sort: 'deadline', minScore: 0 });
    else setFilters({ stages: ['discovered'], sort: tab === 'new' ? 'newest' : 'score', minScore: 0 });
    navigate('discover');
  };
  const TABS: [MatchTab, string][] = [
    ['top', 'Best match'],
    ['new', 'New'],
    ['closing', 'Closing soon'],
  ];
  return (
    <section class="hm-card" aria-labelledby="hm-matches">
      <div class="hm-card-head">
        <h2 id="hm-matches">Top matches</h2>
        <div class="hm-tabs" role="tablist" aria-label="Which matches">
          {TABS.map(([id, label]) => (
            <button type="button" role="tab" aria-selected={tab === id} class={tab === id ? 'on' : ''} onClick={() => pick(id)}>
              {label} <span class="hm-tab-n">{lists[id].length}</span>
            </button>
          ))}
        </div>
        <button type="button" class="hm-link" onClick={seeAll}>
          Discover <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
      {rows.length ? (
        <div role="tabpanel">
          {rows.map((j) => (
            <MatchRow key={j.id} j={j} tab={tab} />
          ))}
          {anyChips ? (
            <div class="hm-legend">
              <span class="hm-chip">skill</span> in your profile
              <span class="hm-chip missing">skill</span> asked for, not in your profile
            </div>
          ) : null}
        </div>
      ) : tab === 'top' ? (
        <Empty
          icon={<Compass size={28} />}
          title={all.length ? "You're all caught up" : 'Fetch your first postings'}
          action={
            <Button variant="primary" onClick={() => void refreshNow()} loading={refreshing.value}>
              <RefreshCw size={15} /> Refresh now
            </Button>
          }
        >
          {all.length ? 'Every new posting has been saved or archived. Refresh to look for more.' : 'InternIQ pulls internships from SimplifyJobs and the companies you follow.'}
        </Empty>
      ) : (
        <p class="hm-empty">{tab === 'new' ? 'No new postings in the last 7 days.' : 'Nothing you are tracking closes in the next two weeks.'}</p>
      )}
    </section>
  );
}

/* ---------- studies and exams ---------- */

function StudiesCard() {
  const today = todayDay();
  const live = programs.value.filter((p) => !['dropped', 'rejected'].includes(p.stage) && p.fit !== 'skip');
  const next = live
    .filter((p) => p.deadline && p.deadline >= today && !['applied', 'admitted'].includes(p.stage))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const tracked = next ? DOC_KEYS.filter((k) => next.docs[k] && next.docs[k] !== 'na') : [];
  const done = next ? tracked.filter((k) => next.docs[k] === 'done') : [];
  const doing = next ? tracked.filter((k) => next.docs[k] === 'doing') : [];
  return (
    <section class="hm-card hm-side tone-studies" aria-labelledby="hm-studies">
      <div class="hm-side-head">
        <span class="hm-side-icon" aria-hidden="true">
          <GraduationCap size={15} />
        </span>
        <h2 id="hm-studies">Further studies</h2>
        <span class="hm-side-count">{live.length ? plural(live.length, 'programme') : ''}</span>
      </div>
      {next ? (
        <>
          <button type="button" class="hm-side-main" onClick={() => navigate('studies')}>
            <span class="hm-side-title">{next.name}</span>
            <span class="hm-side-sub">
              {[next.org, `closes ${dayLong(next.deadline)}${next.confirmed ? '' : ' (expected)'}`].filter(Boolean).join(' · ')}
            </span>
          </button>
          {tracked.length ? (
            <div>
              <div class="hm-docs" aria-hidden="true">
                {tracked.map((k) => (
                  <span class={`hm-doc ${next.docs[k]}`} title={DOC_LABELS[k]} />
                ))}
              </div>
              <p class="hm-side-note">
                {done.length} of {tracked.length} documents ready{doing.length ? `. In progress: ${listJoin(doing.map((k) => DOC_LABELS[k]))}` : ''}.
              </p>
            </div>
          ) : (
            <p class="hm-side-note">Track your CV, SOP and letters for it on the Further studies page.</p>
          )}
        </>
      ) : (
        <button type="button" class="hm-side-main" onClick={() => navigate('studies')}>
          <span class="hm-side-title">No upcoming deadline</span>
          <span class="hm-side-sub">Browse funded master's and PhD programmes</span>
        </button>
      )}
    </section>
  );
}

function ExamsCard() {
  const today = todayDay();
  const live = exams.value.filter((x) => x.stage !== 'dropped');
  const upcoming = live
    .flatMap((x) => x.events.filter((e) => e.date && e.date >= today).map((e) => ({ x, e })))
    .sort((a, b) => a.e.date.localeCompare(b.e.date));
  const firm = upcoming.find((u) => u.e.precision === 'day' && /exam|test|paper/i.test(u.e.label)) ?? upcoming.find((u) => u.e.precision === 'day');
  const others = upcoming.filter((u) => u !== firm).slice(0, 2);
  const name = (s: string) => s.replace(/\s*\(.*\)$/, '');
  return (
    <section class="hm-card hm-side tone-exams" aria-labelledby="hm-exams">
      <div class="hm-side-head">
        <span class="hm-side-icon" aria-hidden="true">
          <Landmark size={15} />
        </span>
        <h2 id="hm-exams">Govt exams</h2>
        <span class="hm-side-count">{live.length ? plural(live.length, 'exam') : ''}</span>
      </div>
      {firm ? (
        <button type="button" class="hm-side-main" onClick={() => navigate('exams')}>
          <span class="hm-countdown">
            <span class="hm-countdown-n">{daysUntil(firm.e.date)}</span>
            <span>
              days to {name(firm.x.name)} {firm.e.label.toLowerCase()}
            </span>
          </span>
        </button>
      ) : (
        <button type="button" class="hm-side-main" onClick={() => navigate('exams')}>
          <span class="hm-side-title">No fixed exam date yet</span>
          <span class="hm-side-sub">Pick the exams you are watching</span>
        </button>
      )}
      {others.length ? (
        <ul class="hm-side-list">
          {others.map(({ x, e }) => (
            <li>
              <AreaDot area="exams" />
              {name(x.name)}: {e.label.toLowerCase()} {e.precision === 'month' ? `around ${asDate(e.date).toLocaleDateString('en-GB', { month: 'long' })}` : dayLong(e.date)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ---------- coming up ---------- */

const KIND_LABEL: Record<CalEvent['kind'], string> = { task: 'task', apply: 'apply', followup: 'follow-up', program: 'deadline', exam: 'exam' };

function ComingUp() {
  const events = useEvents();
  const today = todayDay();
  const horizon = new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
  const agenda = events.filter((e) => !e.done && ((e.refType === 'task' && e.date < today) || (e.date >= today && e.date <= horizon))).slice(0, 8);
  const taskById = new Map(tasks.value.map((t) => [t.id, t] as const));
  return (
    <section class="hm-card" aria-labelledby="hm-coming">
      <div class="hm-card-head">
        <h2 id="hm-coming">Coming up</h2>
        <span class="hm-head-sub">next 14 days</span>
        <button type="button" class="hm-link" onClick={() => navigate('calendar')}>
          Calendar <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
      {agenda.length ? (
        <ul class="hm-agenda">
          {agenda.map((e) => {
            const n = daysUntil(e.date);
            const task: Task | undefined = e.refType === 'task' ? taskById.get(e.refId) : undefined;
            return (
              <li class={n === 0 ? 'today' : ''}>
                <span class={`hm-when${n < 0 ? ' overdue' : n === 0 ? ' now' : ''}`}>{n < 0 ? 'overdue' : n === 0 ? 'Today' : dayShort(e.date)}</span>
                {task ? (
                  <button type="button" class="hm-check" onClick={() => void toggleTask(task)} aria-label={`Mark done: ${e.title}`} title="Mark done" />
                ) : (
                  <span class="hm-dot-wrap">
                    <AreaDot area={e.area} />
                  </span>
                )}
                <button type="button" class="hm-agenda-title" onClick={() => openEvent(e)} disabled={e.refType === 'task'}>
                  {e.approx ? <span title="Expected or unconfirmed date">~ </span> : null}
                  {e.title}
                </button>
                <span class="hm-agenda-meta">{e.time ? e.time : n < 0 ? `${-n}d` : KIND_LABEL[e.kind]}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="hm-empty">Nothing due in the next two weeks.</p>
      )}
    </section>
  );
}

/* ---------- inbox ---------- */

function MailCard({ m }: { m: MailItem }) {
  const job = m.jobId ? jobsById.value.get(m.jobId) : undefined;
  const stage = m.suggestedStage as Stage | '';
  const canMove = Boolean(stage) && (!job || job.stage !== stage);
  const who = m.company || m.fromName || m.from;
  return (
    <div class="hm-mail">
      <span class={`hm-avatar area-${m.area}`} aria-hidden="true">
        {(who[0] ?? '?').toUpperCase()}
      </span>
      <div class="hm-mail-body">
        <div class="hm-mail-top">
          <span class="hm-mail-from">{m.fromName || m.company || m.from}</span>
          <span class="hm-mail-date">{m.date ? dayShort(m.date) : ''}</span>
        </div>
        <div class="hm-mail-subject">{m.subject}</div>
        <div class="hm-mail-actions">
          {job && stage && job.stage === stage ? (
            <span class="hm-done-chip">
              <Check size={11} strokeWidth={3} aria-hidden="true" /> In {STAGE_LABELS[stage]}
            </span>
          ) : null}
          {m.taskId ? (
            <span class="hm-done-chip">
              <Check size={11} strokeWidth={3} aria-hidden="true" /> On calendar
            </span>
          ) : null}
          {canMove ? (
            <Button size="sm" onClick={() => void mailAction(m.id, 'apply-stage')}>
              {job ? `Move to ${STAGE_LABELS[stage as Stage]}` : 'Track application'}
            </Button>
          ) : null}
          {!m.taskId && m.due ? (
            <Button size="sm" onClick={() => void mailAction(m.id, 'task')}>
              Add task, due {dayShort(m.due)}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void mailAction(m.id, 'done')}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function InboxCard() {
  const fresh = mail.value.filter((m) => m.status === 'new');
  return (
    <section class="hm-card" aria-labelledby="hm-inbox">
      <div class="hm-card-head">
        <h2 id="hm-inbox">Inbox</h2>
        <span class="hm-head-sub">{fresh.length ? `${fresh.length} need a look` : 'all caught up'}</span>
        <button type="button" class="hm-link" onClick={() => navigate('mail')}>
          Mail <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
      {fresh.length ? (
        fresh.slice(0, 3).map((m) => <MailCard key={m.id} m={m} />)
      ) : (
        <p class="hm-empty">{lastMailScan.value ? `Nothing new. Last read ${relTime(lastMailScan.value.at)}.` : 'Connect Gmail from the Mail page to sort placement emails here.'}</p>
      )}
    </section>
  );
}

/* ---------- page ---------- */

export function Home() {
  const c = counts.value;
  const p = profile.value;
  const all = jobs.value;
  const today = todayDay();
  const now = new Date();
  const needs = useMemo(buildNeeds, [all, tasks.value, mail.value, programs.value, exams.value, today]);
  const spark = useMemo(() => lastSevenDays(all), [all]);
  const dayAgo = new Date(Date.now() - DAY).toISOString();
  const postedToday = all.filter((j) => j.createdAt > dayAgo).length;
  const emailsToday = mail.value.filter((m) => m.createdAt > dayAgo).length;
  const movedToInterview = activity.value.filter((a) => a.type === 'stage' && a.at > dayAgo && /interviewing/i.test(a.message)).length;
  const last = lastRefresh.value;
  const failed = last?.sources.filter((s) => s.error) ?? [];
  const u = usage.value;
  const responded = c.by.interviewing + c.by.offer + c.by.rejected;
  const applied = c.by.applied + responded;
  const profileThin = p && !p.skills.length && !p.resumeText;
  const nextInterview = needs.find((n) => n.icon === 'video');
  const sparkMax = Math.max(1, ...spark);
  const shown = needs.slice(0, 3);
  const kicker = `${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · WEEK ${isoWeek(now)}`;
  const lead =
    needs.length === 0
      ? 'Nothing urgent right now.'
      : `${needs.length === 1 ? 'One thing needs' : `${needs.length > 9 ? 'Several' : ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][needs.length - 2]} things need`} you this week.`;
  const tail = postedToday ? ` ${plural(postedToday, 'new internship')} came in today.` : c.strong ? ` ${plural(c.strong, 'strong match', 'strong matches')} waiting.` : '';

  return (
    <div class="hm">
      <header class="hm-head">
        <div class="hm-greet">
          <p class="hm-kicker">{kicker}</p>
          <h2 class="hm-title">{greeting(p?.name ?? '')}.</h2>
          <p class="hm-lead">
            {lead}
            {tail}
          </p>
        </div>
        {postedToday || emailsToday || movedToInterview ? (
          <ul class="hm-since" aria-label="In the last 24 hours">
            {postedToday ? (
              <li>
                <b>+{postedToday}</b> {postedToday === 1 ? 'posting' : 'postings'} today
              </li>
            ) : null}
            {emailsToday ? (
              <li>
                <b>{emailsToday}</b> {emailsToday === 1 ? 'email' : 'emails'} sorted
              </li>
            ) : null}
            {movedToInterview ? (
              <li>
                <b>{movedToInterview}</b> moved to Interviewing
              </li>
            ) : null}
          </ul>
        ) : null}
      </header>

      {profileThin ? (
        <Callout kind="warn">
          Scores are rough until you add skills or paste your resume.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), navigate('settings'))}>
            Complete your profile
          </a>
        </Callout>
      ) : null}
      {failed.length ? <Callout kind="warn">Last refresh: {failed.map((s) => `${s.label} (${s.error})`).join('; ')}. Other sources still worked.</Callout> : null}

      <section aria-labelledby="hm-needs">
        <div class="hm-section-head">
          <h2 id="hm-needs">Needs you</h2>
          <span class="hm-n">{needs.length}</span>
          {needs.length > shown.length ? (
            <button type="button" class="hm-link" onClick={() => navigate('calendar')}>
              {needs.length - shown.length} more in Calendar <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {shown.length ? (
          <div class="hm-needs">
            {shown.map((n) => (
              <NeedCard key={n.key} n={n} />
            ))}
          </div>
        ) : (
          <div class="hm-calm">
            <Check size={16} aria-hidden="true" />
            <span>No deadlines, interviews or tasks in the next few days. A good time to review your top matches.</span>
          </div>
        )}
      </section>

      <section class="hm-stats" aria-label="Your numbers">
        <Stat label="New this week" value={c.newThisWeek} foot={`${postedToday} today`} onClick={() => (setFilters({ stages: ['discovered'], sort: 'newest' }), navigate('discover'))}>
          <span class="hm-spark" aria-hidden="true">
            {spark.map((v, i) => (
              <span class={i === 6 ? 'on' : ''} style={{ height: `${Math.max(3, Math.round((v / sparkMax) * 24))}px` }} />
            ))}
          </span>
        </Stat>
        <Stat label="Strong matches" value={c.strong} foot="score 80 or more" tone="accent" onClick={() => (setFilters({ stages: ['discovered', 'saved'], minScore: 80, sort: 'score' }), navigate('discover'))} />
        <Stat label="Applied" value={applied} foot={applied ? `${Math.round((responded / applied) * 100)}% heard back` : 'none yet'} onClick={() => navigate('pipeline')} />
        <Stat label="Interviewing" value={c.by.interviewing} foot={nextInterview ? `next ${dayShort(nextInterview.date)}` : c.by.interviewing ? 'in progress' : 'none yet'} onClick={() => navigate('pipeline')} />
        <Stat label="Offers" value={c.by.offer} foot={c.by.offer ? 'well done' : 'none yet'} tone={c.by.offer ? 'good' : undefined} onClick={() => navigate('pipeline')} />
      </section>

      <div class="hm-grid">
        <div class="hm-col main">
          <TopMatches />
          <div class="hm-pair">
            <StudiesCard />
            <ExamsCard />
          </div>
        </div>
        <div class="hm-col side">
          <ComingUp />
          {features.value.mail ? <InboxCard /> : null}
        </div>
      </div>

      <footer class="hm-status" aria-label="Status">
        <span>
          <span class={`sync-dot${!last ? ' off' : failed.length ? ' bad' : ''}`} aria-hidden="true" />
          {last ? `Internships refreshed ${relTime(last.finishedAt)}, ${plural(last.added, 'new posting')}` : 'Internships not refreshed yet'}
        </span>
        {features.value.mail ? (
          <span>
            <span class={`sync-dot${lastMailScan.value ? '' : ' off'}`} aria-hidden="true" />
            {lastMailScan.value ? `Gmail read ${relTime(lastMailScan.value.at)}` : 'Gmail not connected'}
          </span>
        ) : null}
        <span>
          <span class={`sync-dot${aiReady.value ? ' ai' : ' off'}`} aria-hidden="true" />
          {aiReady.value && u ? `AI scoring on, ${u.aiRequests} of ${u.dailyLimit} used today${u.cooldownUntil ? ', cooling down' : ''}` : 'Free scoring only. Add a free Gemini key in Settings for AI analysis.'}
        </span>
        <button type="button" class="hm-link hm-feedback" onClick={() => (feedbackOpen.value = true)}>
          <MessageSquare size={13} aria-hidden="true" /> Send feedback
        </button>
      </footer>
    </div>
  );
}
