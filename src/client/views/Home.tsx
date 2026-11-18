import { useMemo } from 'preact/hooks';
import { ArrowRight, CircleCheck, CircleX, Compass, History, RefreshCw, Sparkles, TriangleAlert } from 'lucide-preact';
import type { ActivityEntry } from '../../shared/types';
import { dueLabel, greeting, plural, relTime, todayDay } from '../lib/format';
import { activity, aiReady, counts, exams, features, jobs, lastMailScan, lastRefresh, mail, navigate, profile, programs, refreshNow, refreshing, setFilters, usage } from '../state';
import { Button, Callout, Empty } from '../ui';
import { AreaDot, EventRow, useEvents } from './Calendar';
import { JobRow } from './common';

function Tile({ label, value, foot, onClick }: { label: string; value: number | string; foot?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag class="card tile" onClick={onClick} style={onClick ? { textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' } : undefined}>
      <div class="tile-label">{label}</div>
      <div class="tile-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {foot ? <div class="tile-foot">{foot}</div> : null}
    </Tag>
  );
}


function ActivityIcon({ type }: { type: ActivityEntry['type'] }) {
  if (type === 'ai') return <Sparkles size={14} />;
  if (type === 'refresh') return <RefreshCw size={14} />;
  if (type === 'error') return <TriangleAlert size={14} />;
  if (type === 'stage') return <ArrowRight size={14} />;
  return <History size={14} />;
}

export function Home() {
  const c = counts.value;
  const p = profile.value;
  const all = jobs.value;
  const top = useMemo(() => all.filter((j) => j.stage === 'discovered').sort((a, b) => b.score - a.score).slice(0, 6), [all]);
  const events = useEvents();
  const today = todayDay();
  const horizon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const agenda = events.filter((e) => !e.done && ((e.refType === 'task' && e.date < today) || (e.date >= today && e.date <= horizon))).slice(0, 8);
  const inbox = mail.value.filter((m) => m.status === 'new');
  const nextProgram = programs.value
    .filter((p) => p.deadline && p.deadline >= today && p.fit !== 'skip' && !['dropped', 'rejected', 'applied', 'admitted'].includes(p.stage))
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const studyLine = nextProgram ? `next deadline ${dueLabel(nextProgram.deadline)}: ${nextProgram.name}` : `${programs.value.length} programmes tracked`;
  const nextExam = exams.value
    .filter((x) => x.stage !== 'dropped')
    .flatMap((x) => x.events.filter((e) => e.precision === 'day' && e.date >= today).map((e) => ({ x, e })))
    .sort((a, b) => a.e.date.localeCompare(b.e.date))[0];
  const examLine = nextExam ? `${nextExam.x.name.replace(/\s*\(.*\)$/, '')}: ${nextExam.e.label.toLowerCase()} ${dueLabel(nextExam.e.date)}` : `${exams.value.length} exams tracked`;
  const last = lastRefresh.value;
  const failed = last?.sources.filter((s) => s.error) ?? [];
  const u = usage.value;
  const responded = c.by.interviewing + c.by.offer + c.by.rejected;
  const applied = c.by.applied + responded;
  const profileThin = p && !p.skills.length && !p.resumeText;

  return (
    <div class="stack" style={{ gap: 20 }}>
      <div class="row wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 650 }}>{greeting(p?.name ?? '')}</h2>
          <p class="muted" style={{ marginTop: 4 }}>
            {c.newThisWeek ? `${plural(c.newThisWeek, 'new posting')} this week` : 'No new postings this week yet'}
            {c.strong ? `, ${c.strong} strong ${c.strong === 1 ? 'match' : 'matches'} waiting` : ''}.
          </p>
        </div>
      </div>

      {profileThin ? (
        <Callout kind="warn">
          Scores are rough until you add skills or paste your resume.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), navigate('settings'))}>
            Complete your profile
          </a>
        </Callout>
      ) : null}
      {failed.length ? (
        <Callout kind="warn">
          Last refresh: {failed.map((s) => `${s.label} (${s.error})`).join('; ')}. Other sources still worked.
        </Callout>
      ) : null}

      <div class="tiles">
        <Tile label="New this week" value={c.newThisWeek} foot="in Discover" onClick={() => (setFilters({ stages: ['discovered'], sort: 'newest' }), navigate('discover'))} />
        <Tile label="Strong matches" value={c.strong} foot="score 80+" onClick={() => (setFilters({ stages: ['discovered', 'saved'], minScore: 80, sort: 'score' }), navigate('discover'))} />
        <Tile label="Applied" value={applied} foot={applied ? `${Math.round((responded / applied) * 100)}% heard back` : 'no applications yet'} onClick={() => navigate('pipeline')} />
        <Tile label="Interviewing" value={c.by.interviewing} onClick={() => navigate('pipeline')} />
        <Tile label="Offers" value={c.by.offer} onClick={() => navigate('pipeline')} />
      </div>

      <div class="grid home-grid">
        <section class="card">
          <div class="card-head">
            <h2>Top matches to review</h2>
            <span class="sub">highest scores in Discover</span>
            <Button class="grow" variant="ghost" size="sm" onClick={() => (setFilters({ stages: ['discovered'], sort: 'score', minScore: 0 }), navigate('discover'))}>
              See all <ArrowRight size={14} />
            </Button>
          </div>
          {top.length ? (
            top.map((j) => <JobRow key={j.id} job={j} compact />)
          ) : (
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
          )}
        </section>

        <div class="stack">
          <section class="card">
            <div class="card-head">
              <h2>Coming up</h2>
              <span class="sub">next 14 days, all areas</span>
              <Button class="grow" variant="ghost" size="sm" onClick={() => navigate('calendar')}>
                Calendar <ArrowRight size={14} />
              </Button>
            </div>
            <div class="card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {agenda.length ? (
                agenda.map((e) => <EventRow e={e} showDate />)
              ) : (
                <p class="muted small" style={{ padding: '10px 0' }}>
                  Nothing due in the next two weeks.
                </p>
              )}
            </div>
          </section>

          {features.value.mail ? (
            <section class="card">
              <div class="card-head">
                <h2>Inbox</h2>
                <span class="sub">{inbox.length ? `${inbox.length} need attention` : 'all caught up'}</span>
                <Button class="grow" variant="ghost" size="sm" onClick={() => navigate('mail')}>
                  Mail <ArrowRight size={14} />
                </Button>
              </div>
              <div class="card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
                {inbox.slice(0, 4).map((m) => (
                  <button class="tl-item" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => navigate('mail')}>
                    <AreaDot area={m.area} />
                    <span class="ellipsis small">
                      <strong style={{ fontWeight: 600 }}>{m.company || m.fromName}</strong> · {m.subject}
                    </span>
                    <span class="tiny muted">{relTime(m.date)}</span>
                  </button>
                ))}
                {!inbox.length ? (
                  <p class="muted small" style={{ padding: '10px 0' }}>
                    {lastMailScan.value ? `Last scan ${relTime(lastMailScan.value.at)}.` : 'Run the first scan from the Mail page.'}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section class="card">
            <div class="card-head">
              <h2>Beyond internships</h2>
            </div>
            <div class="card-pad stack" style={{ gap: 10 }}>
              <button class="tl-item" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => navigate('studies')}>
                <AreaDot area="studies" />
                <span class="small">
                  <strong style={{ fontWeight: 600 }}>Further studies</strong> · {studyLine}
                </span>
                <ArrowRight size={14} />
              </button>
              <button class="tl-item" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => navigate('exams')}>
                <AreaDot area="exams" />
                <span class="small">
                  <strong style={{ fontWeight: 600 }}>Govt exams</strong> · {examLine}
                </span>
                <ArrowRight size={14} />
              </button>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Status</h2>
            </div>
            <div class="card-pad stack" style={{ gap: 10 }}>
              <div class="row small">
                {last && !failed.length ? <CircleCheck size={15} class="pos" /> : last ? <TriangleAlert size={15} class="neg" /> : <CircleX size={15} class="muted" />}
                <span>{last ? `Refreshed ${relTime(last.finishedAt)}: ${plural(last.added, 'new posting')}` : 'Not refreshed yet'}</span>
              </div>
              <div class="row small">
                <Sparkles size={15} class={aiReady.value ? 'tip' : 'muted'} />
                <span>
                  {aiReady.value && u
                    ? `AI analysis on · ${u.aiRequests}/${u.dailyLimit} requests used today${u.cooldownUntil ? ' · cooling down' : ''}`
                    : 'Free scoring only. Add a free Gemini key for deeper AI analysis.'}
                </span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Recent activity</h2>
            </div>
            <div class="card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {activity.value.length ? (
                <div class="timeline">
                  {activity.value.slice(0, 8).map((a) => (
                    <div class="tl-item">
                      <ActivityIcon type={a.type} />
                      <span class="ink-2">{a.message}</span>
                      <span class="tiny muted">{relTime(a.at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p class="muted small" style={{ padding: '10px 0' }}>
                  Your activity will show up here.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
