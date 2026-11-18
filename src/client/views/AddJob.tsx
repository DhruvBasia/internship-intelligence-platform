import { useState } from 'preact/hooks';
import { FileSpreadsheet, GraduationCap } from 'lucide-preact';
import type { JobInput } from '../../shared/types';
import { call, errorText } from '../api';
import { plural } from '../lib/format';
import { addOpen, openJobId, setJobs, toast, upsertJobs } from '../state';
import { Button, Callout, Field, Modal, Segmented } from '../ui';
import { StageSelect } from './common';

type Mode = 'url' | 'manual' | 'import';

function UrlForm() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await call('addFromUrl', url.trim());
      upsertJobs([out.job]);
      addOpen.value = null;
      openJobId.value = out.job.id;
      toast(out.duplicate ? 'You were already tracking this one' : `Added ${out.job.role} at ${out.job.company}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="stack" onSubmit={submit}>
      <Field label="Job posting link" id="add-url" hint="Works best with Greenhouse, Lever, Ashby, Workday and pages with structured job data. It's scored right away.">
        <input id="add-url" data-autofocus class="input" type="url" required placeholder="https://jobs.lever.co/company/…" value={url} onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} />
      </Field>
      {error ? <Callout kind="error">{error}</Callout> : null}
      <div class="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" type="submit" loading={busy} disabled={!url.trim()}>
          Add job
        </Button>
      </div>
    </form>
  );
}

function ManualForm() {
  const [f, setF] = useState<JobInput>({ company: '', role: '', url: '', location: '', description: '', deadline: '', stage: 'saved', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof JobInput) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await call('createJob', f);
      upsertJobs([out.job]);
      addOpen.value = null;
      toast(`Added ${out.job.role} at ${out.job.company}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="stack" onSubmit={submit}>
      <div class="grid cols-2" style={{ gap: 12 }}>
        <Field label="Role" id="m-role">
          <input id="m-role" data-autofocus class="input" required value={f.role} onInput={set('role')} placeholder="Machine Learning Intern" />
        </Field>
        <Field label="Company" id="m-company">
          <input id="m-company" class="input" required value={f.company} onInput={set('company')} placeholder="Acme AI" />
        </Field>
        <Field label="Location" id="m-loc">
          <input id="m-loc" class="input" value={f.location} onInput={set('location')} placeholder="Bengaluru · Hybrid" />
        </Field>
        <Field label="Deadline" id="m-deadline">
          <input id="m-deadline" class="input" type="date" value={f.deadline} onInput={set('deadline')} />
        </Field>
      </div>
      <Field label="Link" id="m-url">
        <input id="m-url" class="input" type="url" value={f.url} onInput={set('url')} placeholder="https://…" />
      </Field>
      <Field label="Description" id="m-desc" hint="Paste the posting text for an accurate score.">
        <textarea id="m-desc" class="textarea" rows={5} value={f.description} onInput={set('description')} />
      </Field>
      <div class="row">
        <span class="field-label">Stage</span>
        <StageSelect value={f.stage ?? 'saved'} onChange={(stage) => setF({ ...f, stage })} />
      </div>
      {error ? <Callout kind="error">{error}</Callout> : null}
      <div class="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" type="submit" loading={busy}>
          Add job
        </Button>
      </div>
    </form>
  );
}

function ImportForm() {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (label: string, fn: () => Promise<{ added: number; skipped: number; jobs: Parameters<typeof setJobs>[0] }>) => {
    setBusy(label);
    setError('');
    try {
      const out = await fn();
      setJobs(out.jobs);
      addOpen.value = null;
      toast(`Imported ${plural(out.added, 'job')}${out.skipped ? `, skipped ${out.skipped} duplicates or incomplete rows` : ''}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };
  const readFile = async (file: File) => {
    if (file.size > 2_000_000) {
      setError('That file is over 2 MB. Split it or paste the rows instead.');
      return;
    }
    setText(await file.text());
  };
  return (
    <div class="stack">
      <div class="callout">
        <GraduationCap size={18} />
        <div class="stack" style={{ gap: 8 }}>
          <div>
            <strong>Research programs pack</strong>
            <p class="small muted">32 recurring research internships and fellowships (ETH SSRF, Mitacs, MBZUAI, IISc, IITs, MSR India and more) with official links.</p>
          </div>
          <div>
            <Button size="sm" loading={busy === 'pack'} onClick={() => void run('pack', () => call('importStarterPack'))}>
              Add the pack
            </Button>
          </div>
        </div>
      </div>
      <Field label="Paste rows or upload a CSV" id="imp-text" hint="Copy straight from Excel or Google Sheets. Needs a header row with a role/title column and a company column; status, link, deadline, location and notes are picked up too.">
        <textarea id="imp-text" class="textarea" rows={7} value={text} placeholder={'Role\tCompany\tLink\tDeadline\tStatus'} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} />
      </Field>
      <div class="row wrap">
        <label class="btn sm">
          <FileSpreadsheet size={14} /> Choose CSV file
          <input type="file" accept=".csv,.tsv,.txt,text/csv" class="sr-only" onChange={(e) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0];
            if (file) void readFile(file);
          }} />
        </label>
        <span class="spacer" />
        <Button variant="primary" loading={busy === 'tsv'} disabled={!text.trim()} onClick={() => void run('tsv', () => call('importTsv', text))}>
          Import rows
        </Button>
      </div>
      <div class="divider" />
      <Field label="Import from a Google Sheet" id="imp-sheet" hint="Share the sheet as &quot;Anyone with the link can view&quot; first (you can turn sharing off again after importing). Works with your InternIQ v1/v2 sheet or any tracker.">
        <div class="row">
          <input id="imp-sheet" class="input" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheet} onInput={(e) => setSheet((e.currentTarget as HTMLInputElement).value)} />
          <Button loading={busy === 'sheet'} disabled={!sheet.trim()} onClick={() => void run('sheet', () => call('importFromSheet', sheet.trim()))}>
            Import
          </Button>
        </div>
      </Field>
      {error ? <Callout kind="error">{error}</Callout> : null}
    </div>
  );
}

export function AddJobModal({ mode: initial }: { mode: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  return (
    <Modal title="Add jobs" onClose={() => (addOpen.value = null)} wide={mode !== 'url'}>
      <Segmented
        label="How to add"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'url', label: 'From link' },
          { value: 'manual', label: 'Type it in' },
          { value: 'import', label: 'Import' },
        ]}
      />
      {mode === 'url' ? <UrlForm /> : mode === 'manual' ? <ManualForm /> : <ImportForm />}
    </Modal>
  );
}
