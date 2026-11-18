/**
 * Owner dashboard: who is using InternIQ, and a way to suspend an account.
 * The server only answers for emails listed in INTERNIQ_ADMIN_EMAILS.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Clock, RefreshCw, ShieldBan, ShieldCheck } from 'lucide-preact';
import type { AdminOverview, AdminUser } from '../../shared/types';
import { call, errorText } from '../api';
import { relTime } from '../lib/format';
import { email, toast, toastError } from '../state';
import { Button, Callout, Skeleton } from '../ui';

function Tile({ label, value, foot }: { label: string; value: number; foot?: string }) {
  return (
    <div class="card tile">
      <div class="tile-label">{label}</div>
      <div class="tile-value">{value.toLocaleString()}</div>
      {foot ? <div class="tile-foot">{foot}</div> : null}
    </div>
  );
}

function Signups({ days }: { days: AdminOverview['signups'] }) {
  const byDay = new Map(days.map((d) => [d.day, d.count]));
  const cols: { day: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    cols.push({ day, n: byDay.get(day) ?? 0 });
  }
  const max = Math.max(1, ...cols.map((c) => c.n));
  const total = cols.reduce((s, c) => s + c.n, 0);
  return (
    <section class="card card-pad stack" style={{ gap: 10 }}>
      <div class="row">
        <h3 style={{ fontSize: 15 }}>New sign-ups, last 30 days</h3>
        <span class="spacer" />
        <span class="small muted">{total} total</span>
      </div>
      <div class="signup-bars" role="img" aria-label={`${total} sign-ups in the last 30 days`}>
        {cols.map((c) => (
          <span title={`${c.day}: ${c.n}`} style={{ height: c.n ? `${Math.max(6, (c.n / max) * 100)}%` : '2px', opacity: c.n ? 1 : 0.25 }} />
        ))}
      </div>
    </section>
  );
}

export function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    setBusy('load');
    try {
      setData((await call('adminOverview')).overview);
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  useEffect(() => void load(), []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.recent ?? []).filter((u) => !needle || `${u.email} ${u.name} ${u.school}`.toLowerCase().includes(needle));
  }, [data, q]);

  const setBlocked = async (u: AdminUser, blocked: boolean) => {
    if (blocked && !confirm(`Suspend ${u.email}? They will not be able to use InternIQ until you restore access.`)) return;
    setBusy(u.userId);
    try {
      await call('adminSetBlocked', u.userId, blocked);
      setData((d) => (d ? { ...d, recent: d.recent.map((x) => (x.userId === u.userId ? { ...x, blocked } : x)) } : d));
      toast(blocked ? `${u.email} suspended` : `${u.email} restored`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  if (error) return <Callout kind="error">{error}</Callout>;
  if (!data) {
    return (
      <div class="stack">
        <Skeleton h={90} />
        <Skeleton h={220} />
      </div>
    );
  }
  return (
    <div class="stack" style={{ gap: 16 }}>
      <div class="tiles">
        <Tile label="Students" value={data.users} foot="signed up" />
        <Tile label="Active today" value={data.active1d} />
        <Tile label="Active this week" value={data.active7d} foot={data.users ? `${Math.round((data.active7d / data.users) * 100)}% of everyone` : undefined} />
        <Tile label="Gmail connected" value={data.gmailConnected} />
        <Tile label="Applications" value={data.applied} foot={`${data.jobs.toLocaleString()} jobs tracked`} />
      </div>
      <section class="card card-pad stack" style={{ gap: 10 }}>
        <div class="row">
          <Clock size={18} />
          <h3 style={{ fontSize: 15 }}>Hourly automation</h3>
          <span class="spacer" />
          {data.automation.installed ? (
            <span class="small pos">On{data.automation.lastRun ? ` · last run ${relTime(data.automation.lastRun)}${data.automation.lastStatus && data.automation.lastStatus !== 'succeeded' ? ` (${data.automation.lastStatus})` : ''}` : ' · waiting for the first run'}</span>
          ) : (
            <span class="small muted">{data.automation.available ? 'Not scheduled yet' : 'Not available here'}</span>
          )}
        </div>
        <p class="small ink-2" style={{ margin: 0 }}>
          Runs every hour: daily job refreshes at each student's chosen time, Gmail scans, AI queue, and tidying old postings.
        </p>
        {data.automation.available ? (
          <div>
            <Button
              size="sm"
              variant={data.automation.installed ? 'default' : 'primary'}
              loading={busy === 'cron'}
              onClick={async () => {
                setBusy('cron');
                try {
                  const { automation } = await call('adminInstallCron');
                  setData((d) => (d ? { ...d, automation } : d));
                  toast('Hourly automation scheduled');
                } catch (e) {
                  toastError(e);
                } finally {
                  setBusy('');
                }
              }}
            >
              {data.automation.installed ? 'Reinstall schedule' : 'Turn on hourly automation'}
            </Button>
          </div>
        ) : null}
      </section>
      <Signups days={data.signups} />
      <section class="card" style={{ overflow: 'hidden' }}>
        <div class="row card-pad" style={{ gap: 10 }}>
          <h3 style={{ fontSize: 15 }}>People</h3>
          <input class="input sm" style={{ maxWidth: 260 }} placeholder="Search email, name, college" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} aria-label="Search people" />
          <span class="spacer" />
          <Button size="sm" variant="ghost" loading={busy === 'load'} onClick={() => void load()}>
            {busy === 'load' ? null : <RefreshCw size={14} />} Reload
          </Button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>College</th>
                <th>Joined</th>
                <th>Last seen</th>
                <th class="num">Jobs</th>
                <th class="num">Applied</th>
                <th>Gmail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr class={u.blocked ? 'blocked' : ''}>
                  <td>{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td>{u.school || '—'}</td>
                  <td>{relTime(u.createdAt)}</td>
                  <td>{relTime(u.lastSeenAt)}</td>
                  <td class="num">{u.jobs}</td>
                  <td class="num">{u.applied}</td>
                  <td>{u.gmail ? 'Yes' : ''}</td>
                  <td>
                    {u.email === email.value ? (
                      <span class="tiny muted">You</span>
                    ) : (
                      <Button size="sm" variant="ghost" loading={busy === u.userId} onClick={() => void setBlocked(u, !u.blocked)}>
                        {u.blocked ? <ShieldCheck size={14} /> : <ShieldBan size={14} />} {u.blocked ? 'Restore' : 'Suspend'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p class="tiny muted">Only you see this page. Students see their own data only; you cannot open anyone's jobs, notes or emails from here.</p>
    </div>
  );
}
