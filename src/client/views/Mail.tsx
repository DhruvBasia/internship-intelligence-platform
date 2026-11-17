import { useMemo, useState } from 'preact/hooks';
import { ArrowRight, CalendarClock, Check, ExternalLink, Inbox, ListPlus, Mail as MailIcon, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-preact';
import type { MailCategory, MailItem } from '../../shared/types';
import { STAGE_LABELS } from '../../shared/types';
import { dueLabel, plural, relTime } from '../lib/format';
import { features, jobsById, lastMailScan, mail, mailAction, navigate, openJobId, scanMailNow, scanningMail, settings } from '../state';
import { Button, Callout, Empty, ExtLink } from '../ui';
import { AREA_LABEL, AreaDot } from './Calendar';

const CAT_LABEL: Record<MailCategory, string> = {
  eligible: 'Eligible / register',
  applied: 'Application sent',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  'on-hold': 'On hold',
  admissions: 'Admissions',
  exam: 'Exam',
  deadline: 'Deadline',
  other: 'Other',
};
const CAT_CLASS: Partial<Record<MailCategory, string>> = { offer: 'strong', interview: 'good', assessment: 'good', rejected: 'weak', eligible: 'stretch', deadline: 'flag', exam: 'stretch', admissions: 'good' };

type Tab = 'new' | 'all' | 'ignored';

function MailRow({ m }: { m: MailItem }) {
  const job = m.jobId ? jobsById.value.get(m.jobId) : undefined;
  const canApply = m.suggestedStage && (!job || job.stage !== m.suggestedStage);
  return (
    <div class={`mail-row ${m.status}`}>
      <div class="row wrap" style={{ gap: 6 }}>
        <span class={`badge ${CAT_CLASS[m.category] ?? ''}`}>{CAT_LABEL[m.category]}</span>
        <span class="tiny muted row" style={{ gap: 4 }}>
          <AreaDot area={m.area} /> {AREA_LABEL[m.area]}
        </span>
        <span class="spacer" />
        <span class="tiny muted">{relTime(m.date)}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <div class="mail-subject">{m.subject}</div>
        <div class="small ink-2">
          {m.fromName}
          {m.company ? <span class="muted"> · {m.company}</span> : null}
        </div>
        {m.snippet ? <div class="small muted mail-snippet">{m.snippet}</div> : null}
      </div>
      <div class="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {m.due ? (
          <span class="badge flag">
            <CalendarClock size={12} /> {dueLabel(m.due.slice(0, 10))}
            {m.due.length > 10 ? ' · ' + m.due.slice(11, 16) : ''}
          </span>
        ) : null}
        {job ? (
          <button class="badge good" style={{ cursor: 'pointer' }} onClick={() => (openJobId.value = job.id)}>
            {job.company}: {STAGE_LABELS[job.stage]}
          </button>
        ) : null}
        {m.taskId ? (
          <button class="badge" style={{ cursor: 'pointer' }} onClick={() => navigate('calendar')}>
            <Check size={12} /> Task added
          </button>
        ) : null}
        <span class="spacer" />
        <ExtLink href={m.url} class="btn ghost sm">
          <ExternalLink size={14} /> Open
        </ExtLink>
        {canApply ? (
          <Button size="sm" onClick={() => void mailAction(m.id, 'apply-stage')} title={job ? 'Move the application to this stage' : 'Track this application'}>
            <ArrowRight size={14} /> {job ? `Mark ${STAGE_LABELS[m.suggestedStage as keyof typeof STAGE_LABELS].toLowerCase()}` : 'Track application'}
          </Button>
        ) : null}
        {!m.taskId ? (
          <Button size="sm" onClick={() => void mailAction(m.id, 'task')}>
            <ListPlus size={14} /> Task
          </Button>
        ) : null}
        {m.status === 'new' ? (
          <Button size="sm" variant="ghost" onClick={() => void mailAction(m.id, 'done')} title="Mark handled">
            <Check size={14} /> Done
          </Button>
        ) : null}
        {m.status === 'ignored' ? (
          <Button size="sm" variant="ghost" onClick={() => void mailAction(m.id, 'restore')}>
            <RotateCcw size={14} /> Restore
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon onClick={() => void mailAction(m.id, 'ignore')} aria-label="Ignore" title="Ignore (not relevant)">
            <X size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

export function MailView() {
  const [tab, setTab] = useState<Tab>('new');
  const [q, setQ] = useState('');
  const all = mail.value;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((m) => {
      if (tab === 'new' && m.status !== 'new') return false;
      if (tab === 'all' && m.status === 'ignored') return false;
      if (tab === 'ignored' && m.status !== 'ignored') return false;
      if (needle && !(m.subject + ' ' + m.fromName + ' ' + m.company + ' ' + m.snippet).toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [all, tab, q]);
  const counts = { new: all.filter((m) => m.status === 'new').length, ignored: all.filter((m) => m.status === 'ignored').length };
  const last = lastMailScan.value;

  if (!features.value.mail) {
    return (
      <div class="card">
        <Empty icon={<MailIcon size={30} />} title="Email scanning is off in this deployment">
          The public build of InternIQ does not ask for Gmail access. Personal deployments built with private/config.json set to {'{ "mail": true }'} read your placement, admissions and exam emails (read-only) and turn them into application updates and calendar tasks.
        </Empty>
      </div>
    );
  }

  return (
    <div class="stack" style={{ gap: 14 }}>
      <div class="row wrap">
        <div class="segmented" role="group" aria-label="Mail filter">
          <button type="button" aria-pressed={tab === 'new'} onClick={() => setTab('new')}>
            Needs attention {counts.new ? `(${counts.new})` : ''}
          </button>
          <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
            All important
          </button>
          <button type="button" aria-pressed={tab === 'ignored'} onClick={() => setTab('ignored')}>
            Ignored {counts.ignored ? `(${counts.ignored})` : ''}
          </button>
        </div>
        <input class="input sm" style={{ maxWidth: 260 }} placeholder="Search emails" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} aria-label="Search emails" />
        <span class="spacer" />
        <span class="tiny muted">{last ? `Scanned ${relTime(last.at)}` : 'Not scanned yet'}</span>
        <Button variant="primary" onClick={() => void scanMailNow()} loading={scanningMail.value}>
          {scanningMail.value ? null : <RefreshCw size={15} />} Scan inbox
        </Button>
      </div>
      {last?.error ? <Callout kind="warn">{last.error}</Callout> : null}
      {!settings.value?.mail.enabled ? <Callout kind="info">Automatic hourly scanning is off. Turn it on in Settings → Mail.</Callout> : null}
      <div class="card list">
        {list.length ? (
          list.slice(0, 150).map((m) => <MailRow key={m.id} m={m} />)
        ) : (
          <Empty icon={<Inbox size={28} />} title={all.length ? 'All caught up' : 'No emails read yet'} action={all.length ? undefined : <Button variant="primary" onClick={() => void scanMailNow()} loading={scanningMail.value}>Scan inbox now</Button>}>
            {all.length
              ? 'Nothing needs your attention. New placement, admission and exam emails show up here after each scan.'
              : `The first scan reads the last ${settings.value?.mail.lookbackDays ?? 45} days of placement, application, admissions and exam emails. Nothing is sent, deleted or changed in Gmail.`}
          </Empty>
        )}
      </div>
      <p class="tiny muted row" style={{ gap: 6 }}>
        <ShieldCheck size={13} /> Read-only Gmail access, inside your own Google account. {plural(all.length, 'email')} stored in your sheet's Mail tab; job alerts, OTPs and paid "training programs" are filtered out.
      </p>
    </div>
  );
}
