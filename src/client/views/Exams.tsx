import { useMemo, useState } from 'preact/hooks';
import { CalendarPlus, ExternalLink, Landmark, Star } from 'lucide-preact';
import type { Exam, ExamEligibility, ExamStage } from '../../shared/types';
import { EXAM_STAGES, EXAM_STAGE_LABELS } from '../../shared/types';
import { googleCalendarLink } from '../lib/files';
import { daysUntil, dueLabel, plural, shortDate } from '../lib/format';
import { exams, remember, updateExam } from '../state';
import { Button, Callout, Empty, ExtLink, Field, useDebounced } from '../ui';
import { RoadmapList } from './Studies';

const ELIG: Record<ExamEligibility, { label: string; cls: string }> = {
  eligible: { label: 'Eligible', cls: 'strong' },
  'final-year-ok': { label: 'Final-year OK', cls: 'strong' },
  check: { label: 'Check eligibility', cls: 'stretch' },
  'not-eligible': { label: 'Not eligible', cls: 'weak' },
};
const CONF: Record<Exam['confidence'], string> = { official: 'Official calendar', expected: 'Expected dates', watch: 'Irregular: watch' };

function eventLabel(e: Exam['events'][number]): string {
  if (!e.date) return 'TBA';
  return e.precision === 'month' ? '~' + new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : shortDate(e.date);
}

function nextEvent(x: Exam): Exam['events'][number] | undefined {
  return x.events.find((e) => e.date && daysUntil(e.date) >= (e.precision === 'month' ? -30 : 0));
}

function ExamCard({ x }: { x: Exam }) {
  const [notes, setNotes] = useState(x.myNotes);
  const [appNo, setAppNo] = useState(x.applicationNo);
  const [open, setOpen] = useState(false);
  useDebounced(notes, 900, (v) => v !== x.myNotes && void updateExam(x.id, { myNotes: v }));
  useDebounced(appNo, 900, (v) => v !== x.applicationNo && void updateExam(x.id, { applicationNo: v }));
  const nx = nextEvent(x);
  const elig = ELIG[x.forYou];
  return (
    <article class={`card exam ${x.stage === 'dropped' ? 'muted-card' : ''}`}>
      <div class="row" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 class="exam-name">{x.name}</h3>
          <div class="small muted">
            {x.body} · {x.category}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon onClick={() => void updateExam(x.id, { starred: !x.starred })} aria-label={x.starred ? 'Unstar' : 'Star'}>
          <Star size={15} class={x.starred ? 'star-on' : ''} />
        </Button>
      </div>
      <div class="row wrap" style={{ gap: 6 }}>
        <span class={`badge dot ${elig.cls}`}>{elig.label}</span>
        <span class="tag">{x.field === 'core' ? 'Related to your field' : 'General'}</span>
        <span class="tag">{CONF[x.confidence]}</span>
      </div>
      {x.forYouNote ? <p class="small ink-2">{x.forYouNote}</p> : null}
      {x.events.length ? (
        <ol class="exam-timeline">
          {x.events.map((e) => {
            const past = e.date && daysUntil(e.date) < (e.precision === 'month' ? -30 : 0);
            return (
              <li class={past ? 'past' : e === nx ? 'next' : ''}>
                <span class="when">{eventLabel(e)}</span>
                <span class="what">{e.label}</span>
                {e === nx && e.precision === 'day' ? <span class="tiny tip">{dueLabel(e.date)}</span> : null}
                {e.date && !past ? (
                  <ExtLink href={googleCalendarLink({ day: e.date, title: `${x.name}: ${e.label}`, details: x.url })} class="btn ghost sm icon" title="Add to Google Calendar">
                    <CalendarPlus size={13} />
                  </ExtLink>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p class="small muted">No dates announced. Check the official site regularly.</p>
      )}
      <div class="row wrap">
        <select class="select sm" style={{ width: 'auto' }} value={x.stage} aria-label="My status" onChange={(e) => void updateExam(x.id, { stage: (e.currentTarget as HTMLSelectElement).value as ExamStage })}>
          {EXAM_STAGES.map((s) => (
            <option value={s}>{EXAM_STAGE_LABELS[s]}</option>
          ))}
        </select>
        <ExtLink href={x.url} class="btn sm">
          <ExternalLink size={14} /> Official site
        </ExtLink>
        <span class="spacer" />
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Less' : 'Details'}
        </Button>
      </div>
      {open ? (
        <div class="stack" style={{ gap: 8 }}>
          <div class="small">
            <strong>Eligibility:</strong> {x.eligibility}
          </div>
          {x.age ? (
            <div class="small">
              <strong>Age:</strong> {x.age}
            </div>
          ) : null}
          {x.notes ? <div class="small muted">{x.notes}</div> : null}
          <div class="grid cols-2" style={{ gap: 8 }}>
            <Field label="Application / registration no." id={`an-${x.id}`}>
              <input id={`an-${x.id}`} class="input sm" value={appNo} onInput={(e) => setAppNo((e.currentTarget as HTMLInputElement).value)} />
            </Field>
            <Field label="My notes" id={`xn-${x.id}`}>
              <textarea id={`xn-${x.id}`} class="textarea" rows={2} value={notes} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} placeholder="Optional subject, centre, prep plan…" />
            </Field>
          </div>
        </div>
      ) : null}
    </article>
  );
}

const CATS = ['All', 'Civil services', 'Defence', 'Tech & research', 'Banking & finance', 'Staff selection', 'Delhi government'];

export function Exams() {
  const all = exams.value;
  const [cat, setCat] = useState<string>('All');
  const [field, setField] = useState<'all' | 'core'>('all');
  const [showDropped, setShowDropped] = useState(false);
  const list = useMemo(
    () =>
      all
        .filter((x) => (cat === 'All' || x.category === cat || (cat === 'Tech & research' && x.category === 'Engineering services')) && (field === 'all' || x.field === 'core') && (showDropped || x.stage !== 'dropped'))
        .sort((a, b) => {
          if (a.starred !== b.starred) return a.starred ? -1 : 1;
          const an = nextEvent(a)?.date ?? '9999';
          const bn = nextEvent(b)?.date ?? '9999';
          return an.localeCompare(bn);
        }),
    [all, cat, field, showDropped],
  );
  const soon = all
    .filter((x) => x.stage !== 'dropped')
    .flatMap((x) => x.events.filter((e) => e.precision === 'day' && e.date && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 60).map((e) => ({ x, e })))
    .sort((a, b) => a.e.date.localeCompare(b.e.date));

  if (!all.length) {
    return (
      <div class="card">
        <Empty icon={<Landmark size={30} />} title="Loading the exam catalogue">
          Reload the page; the exam list is added the first time you open InternIQ.
        </Empty>
      </div>
    );
  }
  return (
    <div class="stack" style={{ gap: 16 }}>
      {soon.length ? (
        <Callout kind="info">
          <strong>Next 60 days:</strong> {soon.slice(0, 4).map(({ x, e }) => `${x.name.replace(/\s*\(.*\)$/, '').replace(/ 20\d\d$/, '')} (${e.label.replace(/\s*\(.*\)/, '').toLowerCase()}, ${shortDate(e.date)})`).join('; ')}
        </Callout>
      ) : null}
      <RoadmapList area="exams" title="Exam to-dos" sub="registrations, forms, admit cards" />
      <div class="filters" style={{ marginBottom: 0 }}>
        <div class="segmented" role="group" aria-label="Category">
          {CATS.map((c) => (
            <button type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <button type="button" class="chip" aria-pressed={field === 'core'} onClick={() => (setField(field === 'core' ? 'all' : 'core'), remember('exField', field === 'core' ? 'all' : 'core'))}>
          Related to my field
        </button>
        <button type="button" class="chip" aria-pressed={showDropped} onClick={() => setShowDropped(!showDropped)}>
          Show not pursuing
        </button>
      </div>
      <div class="small muted">
        {plural(list.length, 'exam')} · "~" dates are expected from last cycle or the body's calendar; always confirm on the official site before applying.
      </div>
      <div class="exam-grid">
        {list.map((x) => (
          <ExamCard key={x.id} x={x} />
        ))}
      </div>
    </div>
  );
}
