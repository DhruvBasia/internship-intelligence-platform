import { useMemo, useState } from 'preact/hooks';
import { SquareKanban } from 'lucide-preact';
import type { JobSummary, Stage } from '../../shared/types';
import { STAGE_LABELS } from '../../shared/types';
import { verdictOf } from '../lib/format';
import { filters, jobs, moveJob, navigate, openJobId } from '../state';
import { Button, Empty, ScoreRing } from '../ui';
import { DueBadge, StageSelect } from './common';

const COLUMNS: Stage[] = ['saved', 'applied', 'interviewing', 'offer', 'rejected'];

function Card({ job }: { job: JobSummary }) {
  const [dragging, setDragging] = useState(false);
  return (
    <article
      class={`kcard ${dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', job.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => (openJobId.value = job.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openJobId.value = job.id;
      }}
      aria-label={`${job.role} at ${job.company}`}
    >
      <div class="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div class="kcard-title">{job.role}</div>
          <div class="small ink-2 ellipsis">{job.company}</div>
        </div>
        <ScoreRing score={job.score} verdict={verdictOf(job)} size={34} />
      </div>
      <div class="row wrap" style={{ gap: 6 }}>
        <DueBadge job={job} />
        {job.location ? <span class="tag ellipsis" style={{ maxWidth: 170 }}>{job.location}</span> : null}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <StageSelect size="sm" value={job.stage} onChange={(s) => void moveJob(job.id, s)} />
      </div>
    </article>
  );
}

function Column({ stage, items }: { stage: Stage; items: JobSummary[] }) {
  const [over, setOver] = useState(false);
  return (
    <section
      class={`column ${over ? 'drop' : ''}`}
      aria-label={`${STAGE_LABELS[stage]}: ${items.length}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer?.getData('text/plain');
        if (id) void moveJob(id, stage);
      }}
    >
      <div class="column-head">
        {STAGE_LABELS[stage]}
        <span class="count">{items.length}</span>
      </div>
      <div class="column-body">
        {items.length ? items.map((j) => <Card key={j.id} job={j} />) : <div class="tiny muted" style={{ padding: '18px 6px', textAlign: 'center' }}>Drop jobs here</div>}
      </div>
    </section>
  );
}

export function Pipeline() {
  const q = filters.value.q.trim().toLowerCase();
  const byStage = useMemo(() => {
    const out = new Map<Stage, JobSummary[]>(COLUMNS.map((s) => [s, []]));
    for (const j of jobs.value) {
      if (!out.has(j.stage)) continue;
      if (q && !(j.role + ' ' + j.company + ' ' + j.notes).toLowerCase().includes(q)) continue;
      out.get(j.stage)!.push(j);
    }
    for (const list of out.values()) {
      list.sort((a, b) => {
        const ad = a.followUpAt || a.deadline || '9999';
        const bd = b.followUpAt || b.deadline || '9999';
        return ad.localeCompare(bd) || b.score - a.score;
      });
    }
    return out;
  }, [jobs.value, q]);
  const total = Array.from(byStage.values()).reduce((n, l) => n + l.length, 0);
  if (!total && !q) {
    return (
      <div class="card">
        <Empty icon={<SquareKanban size={30} />} title="Your pipeline is empty" action={<Button variant="primary" onClick={() => navigate('discover')}>Browse postings</Button>}>
          Save postings from Discover to start tracking them here. Drag cards between columns as you apply, interview and hear back.
        </Empty>
      </div>
    );
  }
  return (
    <div class="board">
      {COLUMNS.map((s) => (
        <Column key={s} stage={s} items={byStage.get(s)!} />
      ))}
    </div>
  );
}
