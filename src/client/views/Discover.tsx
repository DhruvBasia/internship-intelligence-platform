import { useMemo, useState } from 'preact/hooks';
import { Archive, Bookmark, Compass, Download, RefreshCw, Sparkles, Star, Trash2, X } from 'lucide-preact';
import type { JobSummary, Stage } from '../../shared/types';
import { copyText, downloadText, jobsToCsv } from '../lib/files';
import { plural } from '../lib/format';
import { aiReady, analyze, bulkUpdate, DEFAULT_FILTERS, deleteJobs, filters, jobs, refreshNow, refreshing, setFilters, toast, type DiscoverFilters } from '../state';
import { Button, Empty } from '../ui';
import { JobRow } from './common';

const PAGE = 60;

const STAGE_PRESETS: { label: string; stages: Stage[] }[] = [
  { label: 'Inbox', stages: ['discovered', 'saved'] },
  { label: 'New', stages: ['discovered'] },
  { label: 'Saved', stages: ['saved'] },
  { label: 'In progress', stages: ['applied', 'interviewing', 'offer'] },
  { label: 'Archived', stages: ['archived', 'rejected'] },
  { label: 'All', stages: [] },
];

export function filterJobs(list: JobSummary[], f: DiscoverFilters): JobSummary[] {
  const q = f.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const out = list.filter((j) => {
    if (f.stages.length && !f.stages.includes(j.stage)) return false;
    if (j.score < f.minScore) return false;
    if (f.source && j.source !== f.source) return false;
    if (f.workMode && j.workMode !== f.workMode) return false;
    if (f.starredOnly && !j.starred) return false;
    if (f.aiOnly && j.match?.method !== 'ai') return false;
    if (terms.length) {
      const hay = (j.role + ' ' + j.company + ' ' + j.location + ' ' + j.notes + ' ' + j.tags.join(' ') + ' ' + j.snippet).toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const deadlineKey = (j: JobSummary) => (j.deadline ? j.deadline : '9999');
  out.sort((a, b) => {
    if (f.sort === 'newest') return (b.postedAt || b.createdAt).localeCompare(a.postedAt || a.createdAt);
    if (f.sort === 'deadline') return deadlineKey(a).localeCompare(deadlineKey(b)) || b.score - a.score;
    return b.score - a.score || (b.postedAt || b.createdAt).localeCompare(a.postedAt || a.createdAt);
  });
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  simplify: 'SimplifyJobs',
  greenhouse: 'Greenhouse boards',
  lever: 'Lever boards',
  ashby: 'Ashby boards',
  hn: 'Hacker News',
  wwr: 'We Work Remotely',
  url: 'Added from link',
  manual: 'Added manually',
  import: 'Imported',
};

export function Discover() {
  const f = filters.value;
  const all = jobs.value;
  const list = useMemo(() => filterJobs(all, f), [all, f]);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const sources = useMemo(() => Array.from(new Set(all.map((j) => j.source))).sort(), [all]);
  const presetIdx = STAGE_PRESETS.findIndex((p) => p.stages.join() === f.stages.join());
  const visible = list.slice(0, limit);
  const selIds = Array.from(selected).filter((id) => list.some((j) => j.id === id));
  const allVisibleSelected = visible.length > 0 && visible.every((j) => selected.has(j.id));
  const filtered = JSON.stringify({ ...f, q: '' }) !== JSON.stringify({ ...DEFAULT_FILTERS, q: '' }) || f.q;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      setSelected(new Set());
    } finally {
      setBusy('');
    }
  };
  const exportCsv = async () => {
    const csv = jobsToCsv(list);
    if (downloadText(`interniq-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv')) toast(`Exported ${plural(list.length, 'job')}`);
    else if (await copyText(csv)) toast('Download blocked here, so the CSV was copied to your clipboard');
    else toast('Could not export. Use "Open my sheet" in Settings instead.', 'error');
  };

  if (!all.length) {
    return (
      <div class="card">
        <Empty
          icon={<Compass size={30} />}
          title="No postings yet"
          action={
            <Button variant="primary" onClick={() => void refreshNow()} loading={refreshing.value}>
              <RefreshCw size={15} /> Fetch internships now
            </Button>
          }
        >
          Refresh pulls fresh internships from SimplifyJobs and the companies you follow, then scores each one against your profile for free.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <div class="filters">
        <div class="segmented" role="group" aria-label="Stage filter">
          {STAGE_PRESETS.map((p, i) => (
            <button type="button" aria-pressed={i === presetIdx} onClick={() => setFilters({ stages: p.stages })}>
              {p.label}
            </button>
          ))}
        </div>
        <select class="select sm" style={{ width: 'auto' }} aria-label="Sort" value={f.sort} onChange={(e) => setFilters({ sort: (e.currentTarget as HTMLSelectElement).value as DiscoverFilters['sort'] })}>
          <option value="score">Best match</option>
          <option value="newest">Newest</option>
          <option value="deadline">Deadline</option>
        </select>
        <select class="select sm" style={{ width: 'auto' }} aria-label="Source" value={f.source} onChange={(e) => setFilters({ source: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option value={s}>{SOURCE_LABELS[s] ?? s}</option>
          ))}
        </select>
        <select class="select sm" style={{ width: 'auto' }} aria-label="Work mode" value={f.workMode} onChange={(e) => setFilters({ workMode: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="">Any work mode</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </select>
        <label class="row small ink-2" style={{ gap: 8 }}>
          Min score
          <input type="range" min={0} max={90} step={5} value={f.minScore} aria-label="Minimum score" onInput={(e) => setFilters({ minScore: Number((e.currentTarget as HTMLInputElement).value) })} />
          <span class="num" style={{ width: 22 }}>
            {f.minScore}
          </span>
        </label>
        <button type="button" class="chip" aria-pressed={f.starredOnly} onClick={() => setFilters({ starredOnly: !f.starredOnly })}>
          <Star size={13} /> Starred
        </button>
        <button type="button" class="chip" aria-pressed={f.aiOnly} onClick={() => setFilters({ aiOnly: !f.aiOnly })}>
          <Sparkles size={13} /> AI analysed
        </button>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
            <X size={14} /> Reset
          </Button>
        ) : null}
      </div>

      <div class="row small" style={{ margin: '0 2px 8px' }}>
        <label class="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            class="check"
            checked={allVisibleSelected}
            aria-label="Select all shown"
            onChange={(e) => setSelected((e.currentTarget as HTMLInputElement).checked ? new Set(visible.map((j) => j.id)) : new Set())}
          />
          <span class="muted">
            {plural(list.length, 'posting')}
            {list.length !== all.length ? ` of ${all.length}` : ''}
          </span>
        </label>
        <span class="spacer" />
        <Button variant="ghost" size="sm" onClick={() => void exportCsv()} disabled={!list.length}>
          <Download size={14} /> Export CSV
        </Button>
      </div>

      <div class="card list">
        {visible.length ? (
          visible.map((j) => <JobRow key={j.id} job={j} selected={selected.has(j.id)} onSelect={(on) => toggle(j.id, on)} />)
        ) : (
          <Empty icon={<Compass size={28} />} title="Nothing matches these filters" action={<Button onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Reset filters</Button>}>
            Try a lower minimum score or a different stage tab.
          </Empty>
        )}
      </div>
      {list.length > limit ? (
        <div class="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Button onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more</Button>
        </div>
      ) : null}

      {selIds.length ? (
        <div class="bulkbar" role="toolbar" aria-label="Bulk actions">
          <strong class="small">{selIds.length} selected</strong>
          <Button size="sm" loading={busy === 'save'} onClick={() => void run('save', () => bulkUpdate(selIds, { stage: 'saved' }))}>
            <Bookmark size={14} /> Save
          </Button>
          <Button size="sm" loading={busy === 'archive'} onClick={() => void run('archive', () => bulkUpdate(selIds, { stage: 'archived' }))}>
            <Archive size={14} /> Archive
          </Button>
          {aiReady.value ? (
            <Button
              size="sm"
              loading={busy === 'ai'}
              disabled={selIds.length > 20}
              title={selIds.length > 20 ? 'Select at most 20 for AI analysis' : 'Analyse with AI'}
              onClick={() => void run('ai', () => analyze(selIds))}
            >
              <Sparkles size={14} /> Analyse
            </Button>
          ) : null}
          <Button
            size="sm"
            loading={busy === 'delete'}
            onClick={() => {
              if (confirm(`Delete ${plural(selIds.length, 'job')}? This cannot be undone.`)) void run('delete', () => deleteJobs(selIds));
            }}
          >
            <Trash2 size={14} /> Delete
          </Button>
          <Button size="sm" icon onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X size={14} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
