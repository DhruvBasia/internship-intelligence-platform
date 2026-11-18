import { Archive, Bookmark, BookmarkCheck, CalendarClock, ExternalLink, MapPin, Sparkles, Star, TriangleAlert } from 'lucide-preact';
import type { JobSummary, Stage, Verdict } from '../../shared/types';
import { STAGES, STAGE_LABELS } from '../../shared/types';
import { dueLabel, relTime, VERDICT_LABEL, verdictOf, daysUntil } from '../lib/format';
import { moveJob, openJobId, updateJob } from '../state';
import { Button, ExtLink, ScoreRing } from '../ui';

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span class={`badge dot ${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

export function MethodBadge({ job }: { job: Pick<JobSummary, 'match' | 'aiStatus'> }) {
  if (job.match?.method === 'ai')
    return (
      <span class="badge ai" title={`Analysed by ${job.match.model}`}>
        <Sparkles size={12} /> AI
      </span>
    );
  if (job.aiStatus === 'queued') return <span class="badge" title="Waiting for AI analysis">AI queued</span>;
  return null;
}

export function StageSelect({ value, onChange, size = 'md', id }: { value: Stage; onChange: (s: Stage) => void; size?: 'sm' | 'md'; id?: string }) {
  return (
    <select id={id} class={`select ${size === 'sm' ? 'sm' : ''}`} style={{ width: 'auto' }} value={value} aria-label="Stage" onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as Stage)}>
      {STAGES.map((s) => (
        <option value={s}>{STAGE_LABELS[s]}</option>
      ))}
    </select>
  );
}

export function DueBadge({ job }: { job: Pick<JobSummary, 'deadline' | 'deadlineText' | 'followUpAt' | 'stage'> }) {
  const active = job.stage !== 'archived' && job.stage !== 'rejected';
  if (job.followUpAt && active && (job.stage === 'applied' || job.stage === 'interviewing')) {
    const n = daysUntil(job.followUpAt);
    return (
      <span class={`badge ${n <= 0 ? 'stretch' : ''}`} title="Follow-up date">
        <CalendarClock size={12} /> Follow up {dueLabel(job.followUpAt)}
      </span>
    );
  }
  // Once you have applied, a past application deadline no longer matters.
  const progressed = job.stage === 'applied' || job.stage === 'interviewing' || job.stage === 'offer';
  if (job.deadline && active) {
    const n = daysUntil(job.deadline);
    if (n < -30 || (progressed && n < 0)) return null;
    return (
      <span class={`badge ${n < 0 ? 'weak' : n <= 7 ? 'flag' : ''}`} title="Application deadline">
        <CalendarClock size={12} /> Due {dueLabel(job.deadline)}
      </span>
    );
  }
  if (job.deadlineText && active && !progressed && !/^(varies|tba|tbd|n\/?a|open|-)$/i.test(job.deadlineText.trim())) return <span class="tag">Deadline {job.deadlineText}</span>;
  return null;
}

export function JobRow({ job, selected, onSelect, compact }: { job: JobSummary; selected?: boolean; onSelect?: (on: boolean) => void; compact?: boolean }) {
  const verdict = verdictOf(job);
  const flags = job.match?.flags ?? [];
  const open = () => (openJobId.value = job.id);
  return (
    <div
      class={`job-row ${selected ? 'selected' : ''}`}
      style={compact ? { gridTemplateColumns: '46px minmax(0,1fr) auto' } : undefined}
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={`${job.role} at ${job.company}, score ${job.score}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open();
      }}
    >
      {compact ? null : (
        <input
          type="checkbox"
          class="check"
          checked={selected}
          aria-label={`Select ${job.role} at ${job.company}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelect?.((e.currentTarget as HTMLInputElement).checked)}
        />
      )}
      <ScoreRing score={job.score} verdict={verdict} />
      <div style={{ minWidth: 0 }}>
        <div class="row" style={{ gap: 8, minWidth: 0 }}>
          <span class="job-title ellipsis">{job.role}</span>
          {job.starred ? <Star size={14} class="star-on" aria-label="Starred" /> : null}
        </div>
        <div class="job-meta">
          <span style={{ fontWeight: 550, color: 'var(--ink)' }}>{job.company}</span>
          {job.location ? (
            <>
              <span class="sep">·</span>
              <span class="row ellipsis" style={{ gap: 3, maxWidth: 260 }}>
                <MapPin size={12} />
                <span class="ellipsis">{job.location}</span>
              </span>
            </>
          ) : null}
          <span class="sep">·</span>
          <span class="muted">{job.postedAt ? relTime(job.postedAt) : relTime(job.createdAt)}</span>
          <span class="sep">·</span>
          <span class="muted">{job.sourceLabel}</span>
        </div>
        {compact ? null : (
          <div class="row wrap" style={{ gap: 6, marginTop: 7 }}>
            <VerdictBadge verdict={verdict} />
            <MethodBadge job={job} />
            {job.stage !== 'discovered' ? <span class="badge">{STAGE_LABELS[job.stage]}</span> : null}
            <DueBadge job={job} />
            {flags.slice(0, 1).map((f) => (
              <span class="badge flag" title={f}>
                <TriangleAlert size={12} /> {f.length > 42 ? f.slice(0, 40) + '…' : f}
              </span>
            ))}
            {job.workMode === 'remote' ? <span class="tag">Remote</span> : null}
            {(job.tags ?? [])
              .filter((t) => /^(summer|fall|winter|spring) 20\d\d$/i.test(t))
              .slice(0, 1)
              .map((t) => (
                <span class="tag">{t}</span>
              ))}
          </div>
        )}
      </div>
      <div class="job-actions" onClick={(e) => e.stopPropagation()}>
        {job.stage === 'discovered' ? (
          <Button variant="ghost" size="sm" icon onClick={() => void moveJob(job.id, 'saved')} title="Save to pipeline" aria-label="Save to pipeline">
            <Bookmark size={15} />
          </Button>
        ) : job.stage === 'saved' ? (
          <Button variant="ghost" size="sm" icon title="Saved" aria-label="Saved" onClick={() => void moveJob(job.id, 'discovered')}>
            <BookmarkCheck size={15} />
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon onClick={() => void updateJob(job.id, { starred: !job.starred })} title={job.starred ? 'Unstar' : 'Star'} aria-label={job.starred ? 'Unstar' : 'Star'}>
          <Star size={15} class={job.starred ? 'star-on' : ''} />
        </Button>
        {job.stage !== 'archived' ? (
          <Button variant="ghost" size="sm" icon onClick={() => void moveJob(job.id, 'archived')} title="Not interested (archive)" aria-label="Archive">
            <Archive size={15} />
          </Button>
        ) : null}
        <ExtLink href={job.url} class="btn ghost sm icon" title="Open posting">
          <ExternalLink size={15} />
        </ExtLink>
      </div>
    </div>
  );
}
