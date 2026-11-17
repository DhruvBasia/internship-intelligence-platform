import { useEffect, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import { CalendarDays, ChartColumn, ChevronDown, Compass, FileSpreadsheet, GraduationCap, House, Landmark, Link, Mail, Monitor, Moon, PenLine, Plus, RefreshCw, Search, Settings as Cog, SquareKanban, Sun } from 'lucide-preact';
import { addOpen, aiReady, applyTheme, bootError, counts, email, filters, lastRefresh, loaded, mail, navigate, openJobId, refreshNow, refreshing, setFilters, settings, tasks, theme, usage, view, type View } from './state';
import { todayDay } from './lib/format';
import { Calendar } from './views/Calendar';
import { MailView } from './views/Mail';
import { Studies } from './views/Studies';
import { Exams } from './views/Exams';

const newMail = computed(() => mail.value.filter((m) => m.status === 'new').length);
const dueToday = computed(() => {
  const t = todayDay();
  return tasks.value.filter((x) => x.status === 'todo' && x.due && x.due.slice(0, 10) <= t).length;
});
import { relTime } from './lib/format';
import { Button, Meter, Toasts } from './ui';
import { Home } from './views/Home';
import { Discover } from './views/Discover';
import { Pipeline } from './views/Pipeline';
import { Insights } from './views/Insights';
import { SettingsView } from './views/Settings';
import { Onboarding } from './views/Onboarding';
import { JobDrawer } from './views/JobDrawer';
import { AddJobModal } from './views/AddJob';

const NAV: { id: View; label: string; Icon: typeof House; group: string }[] = [
  { id: 'home', label: 'Home', Icon: House, group: 'Overview' },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays, group: 'Overview' },
  { id: 'mail', label: 'Mail', Icon: Mail, group: 'Overview' },
  { id: 'discover', label: 'Discover', Icon: Compass, group: 'Internships' },
  { id: 'pipeline', label: 'Pipeline', Icon: SquareKanban, group: 'Internships' },
  { id: 'insights', label: 'Insights', Icon: ChartColumn, group: 'Internships' },
  { id: 'studies', label: 'Further studies', Icon: GraduationCap, group: 'Beyond' },
  { id: 'exams', label: 'Govt exams', Icon: Landmark, group: 'Beyond' },
  { id: 'settings', label: 'Settings', Icon: Cog, group: '' },
];
const MOBILE: View[] = ['home', 'calendar', 'discover', 'studies', 'exams', 'mail', 'pipeline', 'settings'];

const TITLES: Record<View, string> = {
  home: 'Home',
  calendar: 'Calendar',
  mail: 'Mail',
  discover: 'Internships · Discover',
  pipeline: 'Internships · Pipeline',
  insights: 'Internships · Insights',
  studies: 'Further studies',
  exams: 'Government exams',
  settings: 'Settings',
};

function AddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (k: 'url' | 'manual' | 'import') => {
    setOpen(false);
    addOpen.value = k;
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant="primary" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Plus size={16} />
        <span class="hide-sm">Add</span>
        <ChevronDown size={14} class="hide-sm" />
      </Button>
      {open ? (
        <div class="card" role="menu" style={{ position: 'absolute', right: 0, top: 40, width: 240, padding: 6, zIndex: 40, boxShadow: 'var(--shadow)' }}>
          <button class="nav-item" role="menuitem" onClick={() => pick('url')}>
            <Link size={16} /> From a job link
          </button>
          <button class="nav-item" role="menuitem" onClick={() => pick('manual')}>
            <PenLine size={16} /> Type it in
          </button>
          <button class="nav-item" role="menuitem" onClick={() => pick('import')}>
            <FileSpreadsheet size={16} /> Import a spreadsheet
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ThemeSwitch() {
  const next = theme.value === 'system' ? 'light' : theme.value === 'light' ? 'dark' : 'system';
  const Icon = theme.value === 'system' ? Monitor : theme.value === 'light' ? Sun : Moon;
  return (
    <Button variant="ghost" size="sm" onClick={() => applyTheme(next)} aria-label={`Theme: ${theme.value}. Switch to ${next}`} title={`Theme: ${theme.value}`}>
      <Icon size={15} />
      <span style={{ textTransform: 'capitalize' }}>{theme.value}</span>
    </Button>
  );
}

function Sidebar() {
  const c = counts.value;
  const u = usage.value;
  const s = settings.value;
  return (
    <nav class="sidebar" aria-label="Main">
      <div class="brand">
        <div class="logo-mark" aria-hidden="true">IQ</div>
        <div>
          <div class="brand-name">InternIQ</div>
          <div class="brand-sub">Internship intelligence</div>
        </div>
      </div>
      {NAV.map(({ id, label, Icon, group }, i) => (
        <>
          {group && group !== NAV[i - 1]?.group ? <div class="nav-group">{group}</div> : null}
          {!group ? <div class="nav-group" /> : null}
          <button class="nav-item" aria-current={view.value === id ? 'page' : undefined} onClick={() => navigate(id)}>
            <Icon size={17} />
            {label}
            {id === 'discover' && c.by.discovered ? <span class="count">{c.by.discovered}</span> : null}
            {id === 'pipeline' && c.active ? <span class="count">{c.active}</span> : null}
            {id === 'mail' && newMail.value ? <span class="count pill">{newMail.value}</span> : null}
            {id === 'calendar' && dueToday.value ? <span class="count pill">{dueToday.value}</span> : null}
          </button>
        </>
      ))}
      <div class="sidebar-foot">
        {s && aiReady.value && u ? (
          <div class="stack" style={{ gap: 6 }}>
            <div class="row small">
              <span class="ink-2">AI today</span>
              <span class="spacer" />
              <span class="num muted">
                {u.aiRequests}/{u.dailyLimit}
              </span>
            </div>
            <Meter value={u.aiRequests} max={u.dailyLimit} label="AI requests used today" />
          </div>
        ) : (
          <button class="nav-item small" style={{ padding: '6px 0' }} onClick={() => navigate('settings')}>
            Free scoring on · add AI
          </button>
        )}
        <div class="row">
          <ThemeSwitch />
        </div>
        <div class="sidebar-email" title={email.value}>
          {email.value}
        </div>
      </div>
    </nav>
  );
}

function MobileNav() {
  return (
    <nav class="mobile-nav" aria-label="Main">
      {MOBILE.map((id) => {
        const { label, Icon } = NAV.find((n) => n.id === id)!;
        return (
          <button aria-current={view.value === id ? 'page' : undefined} onClick={() => navigate(id)}>
            <Icon size={20} />
            {label.replace('Further studies', 'Studies')}
          </button>
        );
      })}
    </nav>
  );
}

function Topbar() {
  const v = view.value;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault();
        if (view.value !== 'discover' && view.value !== 'pipeline') navigate('discover');
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        addOpen.value = 'url';
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const last = lastRefresh.value;
  return (
    <header class="topbar">
      <h1>{TITLES[v]}</h1>
      {v === 'discover' || v === 'pipeline' ? (
        <div class="search">
          <Search size={15} />
          <input
            ref={searchRef}
            class="input"
            type="search"
            placeholder="Search roles, companies, notes"
            aria-label="Search jobs"
            value={filters.value.q}
            onInput={(e) => setFilters({ q: (e.currentTarget as HTMLInputElement).value })}
          />
        </div>
      ) : null}
      <Button onClick={() => void refreshNow()} loading={refreshing.value} title={last ? `Last refreshed ${relTime(last.finishedAt)}` : 'Fetch new postings'}>
        {refreshing.value ? null : <RefreshCw size={15} />}
        <span class="hide-sm">{refreshing.value ? 'Refreshing…' : 'Refresh'}</span>
      </Button>
      <AddMenu />
    </header>
  );
}

export function App() {
  if (bootError.value) {
    return (
      <div class="boot">
        <div class="boot-mark" aria-hidden="true" style={{ animation: 'none' }}>
          IQ
        </div>
        <p style={{ color: 'var(--ink)', fontWeight: 600 }}>InternIQ couldn't load</p>
        <p class="small" style={{ maxWidth: 420, textAlign: 'center' }}>
          {bootError.value}
        </p>
        <Button variant="primary" onClick={() => location.reload()}>
          <RefreshCw size={15} /> Try again
        </Button>
      </div>
    );
  }
  if (!loaded.value || !settings.value) {
    return (
      <div class="boot">
        <div class="boot-mark" aria-hidden="true">
          IQ
        </div>
        <p>Loading your internships…</p>
      </div>
    );
  }
  if (!settings.value.onboarded) return <Onboarding />;
  const v = view.value;
  return (
    <div class="app">
      <Sidebar />
      <div class="main">
        <Topbar />
        <main class="content" id="main">
          {v === 'home' ? (
            <Home />
          ) : v === 'calendar' ? (
            <Calendar />
          ) : v === 'mail' ? (
            <MailView />
          ) : v === 'discover' ? (
            <Discover />
          ) : v === 'pipeline' ? (
            <Pipeline />
          ) : v === 'insights' ? (
            <Insights />
          ) : v === 'studies' ? (
            <Studies />
          ) : v === 'exams' ? (
            <Exams />
          ) : (
            <SettingsView />
          )}
        </main>
      </div>
      <MobileNav />
      {openJobId.value ? <JobDrawer id={openJobId.value} /> : null}
      {addOpen.value ? <AddJobModal mode={addOpen.value} /> : null}
      <Toasts />
    </div>
  );
}
