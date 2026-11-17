import { useEffect, useState } from 'preact/hooks';
import { CalendarPlus, Check, CircleCheck, Copy, ExternalLink, Lightbulb, LoaderCircle, Sparkles, Star, Trash2, TriangleAlert, Wand, X } from 'lucide-preact';
import type { ActivityEntry, CoverLetterOptions, Job, MatchResult } from '../../shared/types';
import { WEIGHTS } from '../../shared/match';
import { call, errorText } from '../api';
import { copyText, googleCalendarLink } from '../lib/files';
import { relTime, shortDate, VERDICT_LABEL, verdictOf } from '../lib/format';
import { aiReady, analyze, deleteJobs, jobsById, moveJob, navigate, openJobId, toast, toastError, updateJob, upsertJobs, usage } from '../state';
import { Button, Callout, Drawer, ExtLink, ScoreRing, Segmented, Skeleton, useDebounced } from '../ui';
import { MethodBadge, StageSelect, VerdictBadge } from './common';

const DIMS: { key: keyof MatchResult['breakdown']; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'role', label: 'Role fit' },
  { key: 'level', label: 'Eligibility' },
  { key: 'location', label: 'Location' },
];

function MatchPanel({ match, score, onAnalyze, analyzing, aiStatus, aiError }: { match: MatchResult | null; score: number; onAnalyze: () => void; analyzing: boolean; aiStatus: Job['aiStatus']; aiError: string }) {
  const verdict = match?.verdict ?? verdictOf({ match, score });
  const isAi = match?.method === 'ai';
  return (
    <section class="stack" style={{ gap: 14 }}>
      <div class="match">
        <ScoreRing score={score} verdict={verdict} size={84} label={`${VERDICT_LABEL[verdict]}: ${score} out of 100`} />
        <div class="stack" style={{ gap: 10 }}>
          <div class="row wrap" style={{ gap: 6 }}>
            <VerdictBadge verdict={verdict} />
            {isAi ? (
              <span class="badge ai">
                <Sparkles size={12} /> AI · {match!.model}
              </span>
            ) : (
              <span class="badge" title="Keyword and rule based, runs free on every job">
                Free match
              </span>
            )}
          </div>
          {match?.summary ? <p class="small ink-2">{match.summary}</p> : null}
          <div class="bars" aria-label="Score breakdown">
            {DIMS.map((d) => (
              <div class="bar-row">
                <span class="ink-2">
                  {d.label} <span class="tiny muted">×{WEIGHTS[d.key]}</span>
                </span>
                <div class="bar-track" role="img" aria-label={`${d.label} ${match?.breakdown[d.key] ?? 0} of 100`}>
                  <div class="bar-fill" style={{ width: `${match?.breakdown[d.key] ?? 0}%` }} />
                </div>
                <span class="num small" style={{ textAlign: 'right' }}>
                  {match?.breakdown[d.key] ?? '–'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {match?.flags.length ? (
        <Callout kind="warn">
          <strong>Check before applying:</strong> {match.flags.join(' · ')}
        </Callout>
      ) : null}

      <div class="grid cols-2" style={{ gap: 18 }}>
        <div>
          <h4 class="section-title">Why it fits</h4>
          {match?.strengths.length ? (
            <ul class="points">
              {match.strengths.map((s) => (
                <li>
                  <CircleCheck size={15} class="pos" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="small muted">No clear strengths found yet.</p>
          )}
        </div>
        <div>
          <h4 class="section-title">Gaps</h4>
          {match?.gaps.length ? (
            <ul class="points">
              {match.gaps.map((s) => (
                <li>
                  <TriangleAlert size={15} class="neg" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="small muted">No obvious gaps.</p>
          )}
        </div>
      </div>
      {match?.tips.length ? (
        <div>
          <h4 class="section-title">Before you apply</h4>
          <ul class="points">
            {match.tips.map((s) => (
              <li>
                <Lightbulb size={15} class="tip" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {match?.matchedSkills.length || match?.missingSkills.length ? (
        <div class="row wrap" style={{ gap: 6 }}>
          {match.matchedSkills.slice(0, 10).map((s) => (
            <span class="badge strong">
              <Check size={12} /> {s}
            </span>
          ))}
          {match.missingSkills.slice(0, 8).map((s) => (
            <span class="badge" title="Mentioned in the posting, not in your profile">
              <X size={12} /> {s}
            </span>
          ))}
        </div>
      ) : null}

      <div class="row wrap" style={{ gap: 10 }}>
        {aiReady.value ? (
          <Button variant={isAi ? 'default' : 'primary'} onClick={onAnalyze} loading={analyzing}>
            {analyzing ? null : <Sparkles size={15} />}
            {analyzing ? 'Analysing…' : isAi ? 'Re-analyse with AI' : 'Analyse with AI'}
          </Button>
        ) : (
          <Button onClick={() => (openJobId.value = null, navigate('settings'))}>
            <Sparkles size={15} /> Set up free AI analysis
          </Button>
        )}
        {aiStatus === 'failed' && aiError ? <span class="small neg">Last AI attempt failed: {aiError}</span> : null}
        {aiStatus === 'queued' ? <span class="small muted">Queued for background AI analysis</span> : null}
        {usage.value && aiReady.value ? (
          <span class="tiny muted">
            {usage.value.aiRequests}/{usage.value.dailyLimit} AI requests today
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CoverLetter({ job, initial }: { job: Job; initial: string }) {
  const [text, setText] = useState(initial);
  const [opts, setOpts] = useState<CoverLetterOptions>({ tone: 'professional', length: 'standard' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  useDebounced(text, 900, async (v) => {
    setSaved('saving');
    try {
      await call('saveCoverLetter', job.id, v);
      setSaved('saved');
    } catch (e) {
      setSaved('idle');
      toastError(e);
    }
  });
  const generate = async () => {
    if (text.trim() && !confirm('Replace the current draft with a new one?')) return;
    setBusy(true);
    try {
      const out = await call('generateCoverLetter', job.id, opts);
      setText(out.text);
      usage.value = out.usage;
      if (out.method === 'local') toast('Template draft created. Add a free AI key for a fully written, tailored letter.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="stack" style={{ gap: 10 }}>
      <div class="row wrap">
        <h4 class="section-title" style={{ margin: 0 }}>
          Cover letter
        </h4>
        <span class="spacer" />
        <Segmented
          label="Tone"
          value={opts.tone}
          onChange={(tone) => setOpts({ ...opts, tone })}
          options={[
            { value: 'professional', label: 'Professional' },
            { value: 'enthusiastic', label: 'Warm' },
            { value: 'concise', label: 'Concise' },
          ]}
        />
        <Segmented
          label="Length"
          value={opts.length}
          onChange={(length) => setOpts({ ...opts, length })}
          options={[
            { value: 'short', label: 'Short' },
            { value: 'standard', label: 'Full' },
          ]}
        />
      </div>
      <textarea class="textarea" rows={text ? 14 : 4} value={text} placeholder="Generate a draft from your profile, then edit it here. Changes save automatically." onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} aria-label="Cover letter" />
      <div class="row wrap">
        <Button variant={text ? 'default' : 'primary'} onClick={() => void generate()} loading={busy}>
          {busy ? null : <Wand size={15} />}
          {text ? 'Regenerate' : aiReady.value ? 'Write with AI' : 'Create template'}
        </Button>
        <Button
          disabled={!text}
          onClick={async () => {
            if (await copyText(text)) toast('Cover letter copied');
          }}
        >
          <Copy size={15} /> Copy
        </Button>
        <span class="spacer" />
        <span class="tiny muted">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
      </div>
      {aiReady.value ? <p class="tiny muted">AI drafts use only what is in your profile and resume. Read and edit before sending.</p> : null}
    </section>
  );
}

export function JobDrawer({ id }: { id: string }) {
  const summary = jobsById.value.get(id);
  const [job, setJob] = useState<Job | null>(null);
  const [letter, setLetter] = useState('');
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState(summary?.notes ?? '');
  const [expanded, setExpanded] = useState(false);
  const close = () => (openJobId.value = null);

  const load = async () => {
    try {
      const out = await call('getJob', id);
      setJob(out.job);
      setLetter(out.coverLetter);
      setLog(out.activity);
      setNotes(out.job.notes);
      const { description: _d, requirements: _r, local: _l, ...rest } = out.job;
      upsertJobs([{ ...rest, snippet: summary?.snippet ?? '' }]);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    setJob(null);
    setError('');
    void load();
  }, [id]);

  useDebounced(notes, 800, (v) => {
    if (job && v !== job.notes) void updateJob(id, { notes: v }, true).then((j) => j && setJob({ ...job, notes: j.notes }));
  });

  if (!summary) {
    return (
      <Drawer label="Job details" onClose={close}>
        <div class="drawer-body">
          <p>This job no longer exists.</p>
        </div>
      </Drawer>
    );
  }
  // Live fields (stage/star/score) come from the shared store so list and drawer stay in sync.
  const live = { ...(job ?? {}), ...summary } as Job;
  const doAnalyze = async () => {
    setAnalyzing(true);
    await analyze([id]);
    setAnalyzing(false);
    void load();
  };
  const setDate = (field: 'deadline' | 'followUpAt', value: string) => void updateJob(id, { [field]: value });

  return (
    <Drawer label={`${summary.role} at ${summary.company}`} onClose={close}>
      <div class="drawer-head">
        <div class="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: 19, fontWeight: 650 }}>{summary.role}</h2>
            <div class="ink-2" style={{ marginTop: 3 }}>
              <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{summary.company}</strong>
              {summary.location ? ` · ${summary.location}` : ''}
            </div>
          </div>
          <Button variant="ghost" icon onClick={close} aria-label="Close details">
            <X size={18} />
          </Button>
        </div>
        <div class="row wrap">
          <StageSelect value={summary.stage} onChange={(s) => void moveJob(id, s)} />
          {summary.stage === 'discovered' || summary.stage === 'saved' ? (
            <Button variant="primary" onClick={() => void moveJob(id, 'applied')}>
              <Check size={15} /> Mark applied
            </Button>
          ) : null}
          <Button icon onClick={() => void updateJob(id, { starred: !summary.starred })} aria-label={summary.starred ? 'Unstar' : 'Star'} title={summary.starred ? 'Unstar' : 'Star'}>
            <Star size={16} class={summary.starred ? 'star-on' : ''} />
          </Button>
          <ExtLink href={summary.url} class="btn">
            <ExternalLink size={15} /> Open posting
          </ExtLink>
          <span class="spacer" />
          <MethodBadge job={summary} />
        </div>
      </div>

      <div class="drawer-body">
        {error ? <Callout kind="error">{error}</Callout> : null}
        <MatchPanel match={live.match} score={live.score} onAnalyze={() => void doAnalyze()} analyzing={analyzing} aiStatus={live.aiStatus} aiError={live.aiError} />

        <section class="grid cols-2" style={{ gap: 14 }}>
          <div class="field">
            <label for="deadline">Application deadline</label>
            <input id="deadline" type="date" class="input" value={summary.deadline} onChange={(e) => setDate('deadline', (e.currentTarget as HTMLInputElement).value)} />
            {summary.deadlineText && !summary.deadline ? <span class="hint">Listed as "{summary.deadlineText}"</span> : null}
          </div>
          <div class="field">
            <label for="followup">Follow-up reminder</label>
            <input id="followup" type="date" class="input" value={summary.followUpAt} onChange={(e) => setDate('followUpAt', (e.currentTarget as HTMLInputElement).value)} />
          </div>
          {summary.deadline || summary.followUpAt ? (
            <div class="row wrap" style={{ gridColumn: '1 / -1', gap: 8 }}>
              {summary.deadline ? (
                <ExtLink class="btn sm" href={googleCalendarLink({ day: summary.deadline, title: `Apply: ${summary.role} at ${summary.company}`, details: summary.url })}>
                  <CalendarPlus size={14} /> Deadline to Google Calendar
                </ExtLink>
              ) : null}
              {summary.followUpAt ? (
                <ExtLink class="btn sm" href={googleCalendarLink({ day: summary.followUpAt, title: `Follow up: ${summary.role} at ${summary.company}`, details: summary.url })}>
                  <CalendarPlus size={14} /> Follow-up to Google Calendar
                </ExtLink>
              ) : null}
            </div>
          ) : null}
        </section>

        <section class="field">
          <label for="notes">Notes</label>
          <textarea id="notes" class="textarea" rows={4} value={notes} placeholder="Recruiter name, referral, interview prep, anything you want to remember" onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
        </section>

        <section>
          <h4 class="section-title">About the role</h4>
          {!job ? (
            <div class="stack" style={{ gap: 8 }}>
              <Skeleton />
              <Skeleton w="85%" />
              <Skeleton w="70%" />
              <span class="tiny muted row" style={{ gap: 6 }}>
                <LoaderCircle size={13} class="spin" /> Loading details from the posting…
              </span>
            </div>
          ) : job.description || job.requirements ? (
            <>
              <div class={`prose ${expanded ? '' : 'collapsed'}`}>
                {job.description}
                {job.requirements ? '\n\nRequirements\n' + job.requirements : ''}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : 'Show full description'}
              </Button>
            </>
          ) : (
            <p class="small muted">This source only lists the title. Open the posting for the full description; AI analysis will try to fetch it too.</p>
          )}
          <div class="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {(summary.tags ?? []).map((t) => (
              <span class="tag">{t}</span>
            ))}
          </div>
          <p class="tiny muted" style={{ marginTop: 8 }}>
            From {summary.sourceLabel}
            {summary.postedAt ? ` · posted ${shortDate(summary.postedAt)}` : ''} · added {relTime(summary.createdAt)}
          </p>
        </section>

        {job ? <CoverLetter key={job.id} job={job} initial={letter} /> : null}

        {log.length ? (
          <section>
            <h4 class="section-title">History</h4>
            <div class="timeline">
              {log.map((a) => (
                <div class="tl-item">
                  <span class="tiny muted">•</span>
                  <span class="small ink-2">{a.message}</span>
                  <span class="tiny muted">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div class="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Delete "${summary.role}" at ${summary.company}? Its notes and cover letter are deleted too.`)) void deleteJobs([id]);
            }}
          >
            <Trash2 size={15} /> Delete job
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
