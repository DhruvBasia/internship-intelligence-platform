import { useMemo, useState } from 'preact/hooks';
import { ChevronDown, ChevronUp, CircleCheck, Circle, ExternalLink, GraduationCap, Plus, Star } from 'lucide-preact';
import type { DocKey, DocStatus, Fit, Funding, Program, ProgramStage, Task } from '../../shared/types';
import { DOC_KEYS, DOC_LABELS, PROGRAM_STAGES, PROGRAM_STAGE_LABELS } from '../../shared/types';
import { call } from '../api';
import { daysUntil, dueLabel, plural, shortDate } from '../lib/format';
import { createTask, programs, remember, tasks, toastError, toggleTask, updateProgram } from '../state';
import { Button, Empty, ExtLink, Field, useDebounced } from '../ui';

export const FIT_LABEL: Record<Exclude<Fit, ''>, string> = { top: 'Priority', ok: 'Realistic', reach: 'Reach', skip: 'Skip' };
const FIT_CLASS: Record<Exclude<Fit, ''>, string> = { top: 'strong', ok: 'good', reach: 'stretch', skip: 'weak' };
const FUNDING_LABEL: Record<Funding, string> = { full: 'Fully funded', free: 'No tuition', part: 'Partly funded', fee: 'Tuition fees', none: 'Not funded' };
const FUNDING_CLASS: Record<Funding, string> = { full: 'strong', free: 'stretch', part: 'stretch', fee: 'flag', none: 'flag' };
const DOC_NEXT: Record<DocStatus, DocStatus> = { todo: 'doing', doing: 'done', done: 'na', na: 'todo' };
const DOC_TEXT: Record<DocStatus, string> = { todo: 'To do', doing: 'In progress', done: 'Done', na: 'Not needed' };

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('iip.' + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function RoadmapList({ area, title, sub }: { area: Task['area']; title: string; sub: string }) {
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState('');
  const list = tasks.value
    .filter((t) => t.area === area)
    .sort((a, b) => (a.status === b.status ? (a.due || '9999').localeCompare(b.due || '9999') : a.status === 'todo' ? -1 : 1));
  const open = list.filter((t) => t.status === 'todo').length;
  const [showDone, setShowDone] = useState(false);
  return (
    <section class="card">
      <div class="card-head">
        <div>
          <h2>{title}</h2>
          <div class="sub">
            {sub} · {plural(open, 'open task')}
          </div>
        </div>
      </div>
      <div class="card-pad" style={{ paddingTop: 6 }}>
        {list
          .filter((t) => showDone || t.status === 'todo')
          .map((t) => {
            const n = t.due ? daysUntil(t.due) : NaN;
            return (
              <div class={`ev-row ${t.status === 'done' ? 'done' : ''}`}>
                <button class="ev-check" onClick={() => void toggleTask(t)} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}>
                  {t.status === 'done' ? <CircleCheck size={17} /> : <Circle size={17} />}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div class="small" style={{ fontWeight: 550 }}>
                    {t.title}
                  </div>
                  {t.notes ? <div class="tiny muted">{t.notes}</div> : null}
                </div>
                {t.due ? <span class={`tiny ${t.status === 'todo' && n < 0 ? 'neg' : n <= 3 ? 'tip' : 'muted'}`}>{dueLabel(t.due.slice(0, 10))}</span> : null}
              </div>
            );
          })}
        {list.some((t) => t.status === 'done') ? (
          <Button variant="ghost" size="sm" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide done' : `Show ${list.filter((t) => t.status === 'done').length} done`}
          </Button>
        ) : null}
        <form
          class="row"
          style={{ marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            if (await createTask({ title: draft.trim(), due, area })) {
              setDraft('');
              setDue('');
            }
          }}
        >
          <input class="input sm" placeholder="Add a step" value={draft} onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)} aria-label="New step" />
          <input class="input sm" type="date" style={{ width: 150 }} value={due} onInput={(e) => setDue((e.currentTarget as HTMLInputElement).value)} aria-label="Due date" />
          <Button size="sm" type="submit" disabled={!draft.trim()}>
            <Plus size={14} />
          </Button>
        </form>
      </div>
    </section>
  );
}

function ProgramRow({ p }: { p: Program }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(p.myNotes);
  useDebounced(notes, 900, (v) => v !== p.myNotes && void updateProgram(p.id, { myNotes: v }));
  const n = p.deadline ? daysUntil(p.deadline) : NaN;
  const past = !Number.isNaN(n) && n < 0;
  const docsDone = DOC_KEYS.filter((k) => p.docs[k] === 'done' || p.docs[k] === 'na').length;
  return (
    <div class={`prog-row ${past ? 'past' : ''}`}>
      <div class="prog-main">
        <div class="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ExtLink href={p.url} class="prog-name">
              {p.name}
            </ExtLink>
            <div class="small muted">{p.org}</div>
          </div>
          <Button variant="ghost" size="sm" icon onClick={() => void updateProgram(p.id, { starred: !p.starred })} aria-label={p.starred ? 'Unstar' : 'Star'}>
            <Star size={15} class={p.starred ? 'star-on' : ''} />
          </Button>
        </div>
        <div class="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <span class="tag">{p.region}</span>
          <span class={`badge ${FUNDING_CLASS[p.funding]}`}>{FUNDING_LABEL[p.funding]}</span>
          {p.fit ? <span class={`badge dot ${FIT_CLASS[p.fit]}`}>{FIT_LABEL[p.fit]}</span> : null}
          {docsDone ? <span class="tag">{docsDone}/{DOC_KEYS.length} documents</span> : null}
        </div>
        {p.requirements ? <div class="small ink-2" style={{ marginTop: 6 }}>{p.requirements}</div> : null}
        {p.note ? <div class="small muted" style={{ marginTop: 4, fontStyle: 'italic' }}>{p.note}</div> : null}
      </div>
      <div class="prog-side">
        <div class="date">{p.deadline ? shortDate(p.deadline) : 'Date TBA'}</div>
        <div class={`tiny ${!past && n <= 14 ? 'neg' : 'muted'}`}>{p.deadline ? (past ? 'closed' : dueLabel(p.deadline)) : p.deadlineText}</div>
        <div class="tiny muted">{p.confirmed ? 'Confirmed date' : 'Usual pattern'}</div>
        <select class="select sm" style={{ marginTop: 6 }} value={p.stage} aria-label="Stage" onChange={(e) => void updateProgram(p.id, { stage: (e.currentTarget as HTMLSelectElement).value as ProgramStage })}>
          {PROGRAM_STAGES.map((s) => (
            <option value={s}>{PROGRAM_STAGE_LABELS[s]}</option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Less' : 'Documents & notes'}
        </Button>
      </div>
      {open ? (
        <div class="prog-more">
          {p.money ? <div class="small"><strong>Funding:</strong> {p.money}</div> : null}
          {p.deadlineText ? <div class="small"><strong>Deadline as listed:</strong> {p.deadlineText}</div> : null}
          <div class="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {DOC_KEYS.map((k: DocKey) => {
              const s = p.docs[k] ?? 'todo';
              return (
                <button type="button" class={`chip doc-${s}`} onClick={() => void updateProgram(p.id, { docs: { ...p.docs, [k]: DOC_NEXT[s] } })} title={`${DOC_LABELS[k]}: ${DOC_TEXT[s]} (click to change)`}>
                  {s === 'done' ? '✓ ' : s === 'doing' ? '◐ ' : s === 'na' ? '– ' : '○ '}
                  {DOC_LABELS[k]}
                </button>
              );
            })}
          </div>
          <Field label="My notes" id={`pn-${p.id}`}>
            <textarea id={`pn-${p.id}`} class="textarea" rows={3} value={notes} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} placeholder="Professors to contact, portal login hints, what to emphasise…" />
          </Field>
          <div class="row wrap">
            <select class="select sm" style={{ width: 'auto' }} value={p.fit} aria-label="My rating" onChange={(e) => void updateProgram(p.id, { fit: (e.currentTarget as HTMLSelectElement).value as Fit })}>
              <option value="">No rating</option>
              {(['top', 'ok', 'reach', 'skip'] as const).map((f) => (
                <option value={f}>{FIT_LABEL[f]}</option>
              ))}
            </select>
            <ExtLink href={p.url} class="btn sm">
              <ExternalLink size={14} /> Official page
            </ExtLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddProgram({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', org: '', url: '', deadline: '', region: 'Other', funding: 'none' as Funding });
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="card card-pad stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { program } = await call('createProgram', f);
          programs.value = [program, ...programs.value];
          onDone();
        } catch (err) {
          toastError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div class="grid cols-2" style={{ gap: 10 }}>
        <Field label="Programme" id="np-name">
          <input id="np-name" class="input" required value={f.name} onInput={(e) => setF({ ...f, name: (e.currentTarget as HTMLInputElement).value })} placeholder="MSc Artificial Intelligence" />
        </Field>
        <Field label="University" id="np-org">
          <input id="np-org" class="input" value={f.org} onInput={(e) => setF({ ...f, org: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
        <Field label="Link" id="np-url">
          <input id="np-url" class="input" type="url" value={f.url} onInput={(e) => setF({ ...f, url: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
        <Field label="Deadline" id="np-dl">
          <input id="np-dl" class="input" type="date" value={f.deadline} onInput={(e) => setF({ ...f, deadline: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
      </div>
      <div class="row">
        <select class="select sm" style={{ width: 'auto' }} value={f.funding} onChange={(e) => setF({ ...f, funding: (e.currentTarget as HTMLSelectElement).value as Funding })} aria-label="Funding">
          {(Object.keys(FUNDING_LABEL) as Funding[]).map((k) => (
            <option value={k}>{FUNDING_LABEL[k]}</option>
          ))}
        </select>
        <span class="spacer" />
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy}>
          Add programme
        </Button>
      </div>
    </form>
  );
}

const REGIONS = ['All', 'Erasmus Mundus', 'UAE & Gulf', 'Germany', 'Other'];

export function Studies() {
  const all = programs.value;
  const [region, setRegion] = useState<string>(stored('stRegion', 'All'));
  const [fit, setFit] = useState<string>(stored('stFit', 'active'));
  const [funded, setFunded] = useState<boolean>(stored('stFunded', false));
  const [hidePast, setHidePast] = useState(true);
  const [starred, setStarred] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => {
        if (region !== 'All' && (region === 'Other' ? ['Erasmus Mundus', 'UAE & Gulf', 'Germany'].includes(p.region) : p.region !== region)) return false;
        if (fit === 'active' && (p.fit === 'skip' || p.stage === 'dropped')) return false;
        if (fit === 'top' && p.fit !== 'top') return false;
        if (fit === 'pipeline' && !['preparing', 'applied', 'interview', 'admitted'].includes(p.stage)) return false;
        if (funded && p.funding !== 'full') return false;
        if (starred && !p.starred) return false;
        if (hidePast && p.deadline && daysUntil(p.deadline) < 0 && !['applied', 'interview', 'admitted'].includes(p.stage)) return false;
        if (needle && !(p.name + ' ' + p.org + ' ' + p.requirements + ' ' + p.note).toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  }, [all, region, fit, funded, hidePast, starred, q]);
  const count = (s: ProgramStage[]) => all.filter((p) => s.includes(p.stage)).length;
  const fitRank = (f: Fit) => ({ top: 0, ok: 1, '': 2, reach: 3, skip: 4 })[f];
  const next = all
    .filter((p) => p.deadline && daysUntil(p.deadline) >= 0 && p.fit !== 'skip' && !['dropped', 'rejected', 'applied', 'admitted'].includes(p.stage))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || fitRank(a.fit) - fitRank(b.fit) || Number(b.confirmed) - Number(a.confirmed))[0];

  if (!all.length) {
    return (
      <div class="card">
        <Empty icon={<GraduationCap size={30} />} title="Loading the study-abroad catalogue">
          Reload the page; the programme catalogue is added the first time you open InternIQ.
        </Empty>
      </div>
    );
  }
  const set = <T,>(fn: (v: T) => void, key: string) => (v: T) => (fn(v), remember(key, v));

  return (
    <div class="stack" style={{ gap: 16 }}>
      <div class="tiles">
        <div class="card tile">
          <div class="tile-label">Next deadline</div>
          <div class="tile-value" style={{ fontSize: 18 }}>{next ? dueLabel(next.deadline) : '—'}</div>
          <div class="tile-foot ellipsis">{next ? next.name : 'No open deadlines'}</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Preparing</div>
          <div class="tile-value">{count(['preparing'])}</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Applied</div>
          <div class="tile-value">{count(['applied', 'interview'])}</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Admitted</div>
          <div class="tile-value">{count(['admitted'])}</div>
        </div>
        <div class="card tile">
          <div class="tile-label">Fully funded options</div>
          <div class="tile-value">{all.filter((p) => p.funding === 'full' && p.fit !== 'skip').length}</div>
        </div>
      </div>

      <RoadmapList area="studies" title="Application roadmap" sub="documents, tests and drafts, in order" />

      <div class="filters" style={{ marginBottom: 0 }}>
        <div class="segmented" role="group" aria-label="Region">
          {REGIONS.map((r) => (
            <button type="button" aria-pressed={region === r} onClick={() => set(setRegion, 'stRegion')(r)}>
              {r}
            </button>
          ))}
        </div>
        <select class="select sm" style={{ width: 'auto' }} value={fit} onChange={(e) => set(setFit, 'stFit')((e.currentTarget as HTMLSelectElement).value)} aria-label="Which programmes">
          <option value="active">Hide skipped</option>
          <option value="top">Priority only</option>
          <option value="pipeline">My applications</option>
          <option value="all">Everything</option>
        </select>
        <button type="button" class="chip" aria-pressed={funded} onClick={() => set(setFunded, 'stFunded')(!funded)}>
          Fully funded
        </button>
        <button type="button" class="chip" aria-pressed={starred} onClick={() => setStarred(!starred)}>
          <Star size={13} /> Starred
        </button>
        <button type="button" class="chip" aria-pressed={!hidePast} onClick={() => setHidePast(!hidePast)}>
          Show closed
        </button>
        <input class="input sm" style={{ maxWidth: 220 }} placeholder="Search" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} aria-label="Search programmes" />
        <span class="spacer" />
        <Button size="sm" onClick={() => setAdding(!adding)}>
          <Plus size={14} /> Add programme
        </Button>
      </div>
      {adding ? <AddProgram onDone={() => setAdding(false)} /> : null}

      <div class="small muted">
        {plural(list.length, 'programme')} · sorted by deadline · ratings and notes are yours, facts are from official pages (checked 14 Nov 2026)
      </div>
      <div class="card list">
        {list.length ? list.map((p) => <ProgramRow key={p.id} p={p} />) : <Empty icon={<GraduationCap size={26} />} title="No programmes match these filters" />}
      </div>
    </div>
  );
}
