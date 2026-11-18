import { useMemo, useState } from 'preact/hooks';
import { CalendarPlus, ChevronLeft, ChevronRight, CircleCheck, Circle, Download, ExternalLink, Mail, Plus, Trash2 } from 'lucide-preact';
import { buildEvents, groupByDate, icsCalendar, monthGrid, type CalEvent } from '../../shared/calendar';
import type { Area } from '../../shared/types';
import { copyText, downloadText, googleCalendarLink } from '../lib/files';
import { daysUntil, dueLabel, plural, todayDay } from '../lib/format';
import { calendarDay, createTask, deleteTask, exams, jobs, navigate, openJobId, programs, remember, tasks, toast, toggleTask } from '../state';
import { Button, ExtLink } from '../ui';

export const AREA_LABEL: Record<Area, string> = { internships: 'Internships', studies: 'Further studies', exams: 'Govt exams', general: 'Tasks' };
const AREAS: Area[] = ['internships', 'studies', 'exams', 'general'];

export function AreaDot({ area }: { area: Area }) {
  return <span class={`area-dot ${area}`} aria-hidden="true" />;
}

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('iip.' + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useEvents() {
  return useMemo(() => buildEvents({ jobs: jobs.value, programs: programs.value, exams: exams.value, tasks: tasks.value }), [jobs.value, programs.value, exams.value, tasks.value]);
}

export function openEvent(e: CalEvent): void {
  if (e.refType === 'job') openJobId.value = e.refId;
  else if (e.refType === 'program') navigate('studies');
  else if (e.refType === 'exam') navigate('exams');
}

export function EventRow({ e, showDate }: { e: CalEvent; showDate?: boolean }) {
  const task = e.refType === 'task' ? tasks.value.find((t) => t.id === e.refId) : undefined;
  const overdue = !e.done && daysUntil(e.date) < 0;
  return (
    <div class={`ev-row ${e.done ? 'done' : ''}`}>
      {task ? (
        <button class="ev-check" onClick={() => void toggleTask(task)} aria-label={e.done ? 'Mark not done' : 'Mark done'} title={e.done ? 'Mark not done' : 'Mark done'}>
          {e.done ? <CircleCheck size={17} /> : <Circle size={17} />}
        </button>
      ) : (
        <AreaDot area={e.area} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <button class="ev-title" onClick={() => openEvent(e)} disabled={e.refType === 'task'}>
          {e.approx ? <span class="muted" title="Expected or unconfirmed date">~ </span> : null}
          {e.title}
        </button>
        <div class="tiny muted row wrap" style={{ gap: 6 }}>
          {showDate ? <span class={overdue ? 'neg' : ''}>{dueLabel(e.date)}</span> : null}
          {e.time ? <span>{e.time}</span> : null}
          <span>
            <AreaDot area={e.area} /> {AREA_LABEL[e.area]}
          </span>
          {e.sub ? <span class="ellipsis" style={{ maxWidth: 220 }}>{e.sub}</span> : null}
        </div>
      </div>
      <div class="row" style={{ gap: 2 }}>
        {e.link ? (
          <ExtLink href={e.link} class="btn ghost sm icon" title={/mail\.google/.test(e.link) ? 'Open email' : 'Open link'}>
            {/mail\.google/.test(e.link) ? <Mail size={14} /> : <ExternalLink size={14} />}
          </ExtLink>
        ) : null}
        <ExtLink href={googleCalendarLink({ day: e.date, title: e.title, details: [e.sub, e.link].filter(Boolean).join('\n') })} class="btn ghost sm icon" title="Add to Google Calendar">
          <CalendarPlus size={14} />
        </ExtLink>
        {task ? (
          <Button variant="ghost" size="sm" icon onClick={() => void deleteTask(task.id)} aria-label="Delete task" title="Delete task">
            <Trash2 size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function QuickAdd({ day }: { day: string }) {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<Area>('general');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const t = await createTask({ title: title.trim(), due: time ? `${day}T${time}` : day, allDay: !time, area });
    setBusy(false);
    if (t) {
      setTitle('');
      setTime('');
    }
  };
  return (
    <form class="stack" style={{ gap: 8 }} onSubmit={submit}>
      <input class="input" placeholder="Add a task or reminder for this day" value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} aria-label="New task" />
      <div class="row wrap">
        <select class="select sm" style={{ width: 'auto' }} value={area} onChange={(e) => setArea((e.currentTarget as HTMLSelectElement).value as Area)} aria-label="Area">
          {AREAS.map((a) => (
            <option value={a}>{AREA_LABEL[a]}</option>
          ))}
        </select>
        <input class="input sm" type="time" style={{ width: 'auto' }} value={time} onInput={(e) => setTime((e.currentTarget as HTMLInputElement).value)} aria-label="Time (optional)" />
        <span class="spacer" />
        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!title.trim()}>
          <Plus size={14} /> Add
        </Button>
      </div>
    </form>
  );
}

export function Calendar() {
  const all = useEvents();
  const [hidden, setHidden] = useState<Area[]>(stored('calHidden', []));
  const [mode, setMode] = useState<'month' | 'agenda'>(stored('calMode', 'month'));
  const sel = calendarDay.value;
  const [ym, setYm] = useState(() => ({ y: Number(sel.slice(0, 4)), m: Number(sel.slice(5, 7)) - 1 }));
  const events = all.filter((e) => !hidden.includes(e.area));
  const byDate = useMemo(() => groupByDate(events), [events]);
  const days = monthGrid(ym.y, ym.m);
  const today = todayDay();
  const monthName = new Date(Date.UTC(ym.y, ym.m, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayEvents = byDate.get(sel) ?? [];
  const overdue = events.filter((e) => e.refType === 'task' && !e.done && e.date < today);
  const agenda = events.filter((e) => e.date >= today && !e.done).slice(0, 80);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m + delta, 1));
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  const toggleArea = (a: Area) => {
    const next = hidden.includes(a) ? hidden.filter((x) => x !== a) : [...hidden, a];
    setHidden(next);
    remember('calHidden', next);
  };
  const exportIcs = async () => {
    const ics = icsCalendar(events.filter((e) => !e.done && e.date >= today));
    if (downloadText('interniq-calendar.ics', ics, 'text/calendar')) toast('Calendar file downloaded: open it to add everything to Google or Apple Calendar');
    else if (await copyText(ics)) toast('Download blocked here, so the .ics text was copied to your clipboard');
  };

  return (
    <div class="stack" style={{ gap: 14 }}>
      <div class="row wrap">
        <div class="segmented" role="group" aria-label="View">
          {(['month', 'agenda'] as const).map((m) => (
            <button type="button" aria-pressed={mode === m} onClick={() => (setMode(m), remember('calMode', m))}>
              {m === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
        <div class="row wrap" style={{ gap: 6 }}>
          {AREAS.map((a) => (
            <button type="button" class="chip area-chip" aria-pressed={!hidden.includes(a)} onClick={() => toggleArea(a)}>
              <AreaDot area={a} /> {AREA_LABEL[a]}
            </button>
          ))}
        </div>
        <span class="spacer" />
        <Button size="sm" variant="ghost" onClick={() => navigate('settings', 'tab=automation')} title="Subscribe in Google or Apple Calendar so dates stay in sync">
          <CalendarPlus size={14} /> Subscribe
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void exportIcs()} title="Download upcoming dates as a one-off .ics file">
          <Download size={14} /> Export .ics
        </Button>
      </div>

      {overdue.length ? (
        <section class="card">
          <div class="card-head">
            <h2>Overdue</h2>
            <span class="sub">{plural(overdue.length, 'task')}</span>
          </div>
          <div class="card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {overdue.slice(0, 8).map((e) => (
              <EventRow e={e} showDate />
            ))}
          </div>
        </section>
      ) : null}

      {mode === 'month' ? (
        <div class="cal-layout">
          <section class="card cal">
            <div class="cal-head">
              <Button variant="ghost" size="sm" icon onClick={() => shift(-1)} aria-label="Previous month">
                <ChevronLeft size={16} />
              </Button>
              <h2>{monthName}</h2>
              <Button variant="ghost" size="sm" icon onClick={() => shift(1)} aria-label="Next month">
                <ChevronRight size={16} />
              </Button>
              <span class="spacer" />
              <Button
                size="sm"
                onClick={() => {
                  calendarDay.value = today;
                  setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
                }}
              >
                Today
              </Button>
            </div>
            <div class="cal-grid" role="grid" aria-label={monthName}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div class="cal-dow" role="columnheader">
                  {d}
                </div>
              ))}
              {days.map((day) => {
                const evs = byDate.get(day) ?? [];
                const inMonth = Number(day.slice(5, 7)) - 1 === ym.m;
                const open = evs.filter((e) => !e.done);
                return (
                  <button
                    type="button"
                    role="gridcell"
                    class={`cal-cell ${inMonth ? '' : 'out'} ${day === today ? 'today' : ''} ${day === sel ? 'sel' : ''}`}
                    onClick={() => (calendarDay.value = day)}
                    aria-label={`${day}: ${plural(evs.length, 'item')}`}
                    aria-selected={day === sel}
                  >
                    <span class="cal-num">{Number(day.slice(8))}</span>
                    <span class="cal-evs">
                      {open.slice(0, 3).map((e) => (
                        <span class={`cal-ev ${e.area}`} title={e.title}>
                          {e.approx ? '~' : ''}
                          {e.title}
                        </span>
                      ))}
                      {open.length > 3 ? <span class="tiny muted">+{open.length - 3} more</span> : null}
                      {open.length ? (
                        <span class="cal-dots" aria-hidden="true">
                          {open.slice(0, 5).map((e) => (
                            <AreaDot area={e.area} />
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2>{new Date(sel + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
                <div class="sub">{dayEvents.length ? plural(dayEvents.length, 'item') : 'Nothing scheduled'}</div>
              </div>
            </div>
            <div class="card-pad stack" style={{ gap: 12 }}>
              <div>
                {dayEvents.map((e) => (
                  <EventRow e={e} />
                ))}
              </div>
              <QuickAdd day={sel} />
            </div>
          </section>
        </div>
      ) : (
        <section class="card">
          <div class="card-head">
            <h2>Coming up</h2>
            <span class="sub">everything dated, soonest first; "~" marks expected dates</span>
          </div>
          <div class="card-pad" style={{ paddingTop: 4 }}>
            {agenda.length ? (
              agenda.map((e, i) => (
                <>
                  {i === 0 || agenda[i - 1]!.date.slice(0, 7) !== e.date.slice(0, 7) ? (
                    <div class="section-title" style={{ marginTop: 14 }}>
                      {new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </div>
                  ) : null}
                  <EventRow e={e} showDate />
                </>
              ))
            ) : (
              <p class="muted small" style={{ padding: '12px 0' }}>
                Nothing upcoming. Add tasks from any day in Month view.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
