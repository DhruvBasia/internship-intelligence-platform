/**
 * One timeline for everything dated: application deadlines and follow-ups,
 * programme deadlines, exam milestones and tasks (manual, roadmap, from email).
 */
import type { Area, Exam, JobSummary, Program, Task } from './types';

export type EventKind = 'task' | 'apply' | 'followup' | 'program' | 'exam';

export interface CalEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm or '' */
  time: string;
  title: string;
  sub: string;
  area: Area;
  kind: EventKind;
  /** Month-precision or unconfirmed date. */
  approx: boolean;
  done: boolean;
  refType: 'job' | 'program' | 'exam' | 'task';
  refId: string;
  link: string;
}

export function buildEvents(input: { jobs: JobSummary[]; programs: Program[]; exams: Exam[]; tasks: Task[] }): CalEvent[] {
  const out: CalEvent[] = [];
  for (const t of input.tasks) {
    if (!t.due) continue;
    out.push({
      id: 'task:' + t.id,
      date: t.due.slice(0, 10),
      time: t.due.length > 10 ? t.due.slice(11, 16) : '',
      title: t.title,
      sub: t.source === 'mail' ? 'From email' : t.source === 'roadmap' ? 'Roadmap' : 'Task',
      area: t.area,
      kind: 'task',
      approx: false,
      done: t.status === 'done',
      refType: 'task',
      refId: t.id,
      link: t.link,
    });
  }
  for (const j of input.jobs) {
    if (j.stage === 'archived' || j.stage === 'rejected') continue;
    if (j.deadline && (j.stage === 'discovered' || j.stage === 'saved')) {
      out.push({ id: 'apply:' + j.id, date: j.deadline, time: '', title: `Apply: ${j.role}`, sub: j.company, area: 'internships', kind: 'apply', approx: false, done: false, refType: 'job', refId: j.id, link: j.url });
    }
    if (j.followUpAt) {
      out.push({ id: 'follow:' + j.id, date: j.followUpAt, time: '', title: `Follow up: ${j.company}`, sub: j.role, area: 'internships', kind: 'followup', approx: false, done: false, refType: 'job', refId: j.id, link: j.url });
    }
  }
  for (const p of input.programs) {
    if (!p.deadline || ['rejected', 'dropped', 'admitted'].includes(p.stage) || p.fit === 'skip') continue;
    out.push({
      id: 'program:' + p.id,
      date: p.deadline,
      time: '',
      title: `${p.stage === 'applied' ? 'Closed for you · ' : ''}Deadline: ${p.name}`,
      sub: p.org,
      area: 'studies',
      kind: 'program',
      approx: !p.confirmed,
      done: p.stage === 'applied',
      refType: 'program',
      refId: p.id,
      link: p.url,
    });
  }
  for (const x of input.exams) {
    if (x.stage === 'dropped') continue;
    x.events.forEach((e, i) => {
      if (!e.date) return;
      out.push({
        id: `exam:${x.id}:${i}`,
        date: e.date,
        time: '',
        title: `${x.name.replace(/\s*\(.*\)$/, '')}: ${e.label}`,
        sub: x.body,
        area: 'exams',
        kind: 'exam',
        approx: e.precision === 'month' || x.confidence !== 'official' || /expected|usual/i.test(e.label),
        done: false,
        refType: 'exam',
        refId: x.id,
        link: x.url,
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title));
}

/** Monday-first 6-week grid of YYYY-MM-DD strings covering the given month. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month, 1 - offset));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

export function groupByDate(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const e of events) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  }
  return map;
}

export function icsCalendar(events: CalEvent[], stamp = new Date()): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const dt = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//InternIQ//EN', 'X-WR-CALNAME:InternIQ'];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    const next = new Date(e.date + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const end = next.toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id.replace(/[^A-Za-z0-9:_-]/g, '')}@interniq`, `DTSTAMP:${dt}`);
    if (e.time) {
      const t = e.time.replace(':', '') + '00';
      lines.push(`DTSTART;TZID=Asia/Kolkata:${d}T${t}`, `DURATION:PT1H`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`);
    }
    lines.push(`SUMMARY:${esc((e.approx ? '~ ' : '') + e.title)}`, `DESCRIPTION:${esc([e.sub, e.link].filter(Boolean).join('\n'))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
