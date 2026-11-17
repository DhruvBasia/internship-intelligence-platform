import type { JobSummary } from '../../shared/types';
import { STAGE_LABELS } from '../../shared/types';

function csvCell(v: unknown): string {
  let s = String(v ?? '');
  // Neutralise spreadsheet formulas when the CSV is opened in Excel/Sheets.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function jobsToCsv(jobs: JobSummary[]): string {
  const header = ['role', 'company', 'location', 'stage', 'score', 'verdict', 'url', 'deadline', 'followUpAt', 'appliedAt', 'source', 'starred', 'notes', 'createdAt'];
  const rows = jobs.map((j) => [
    j.role,
    j.company,
    j.location,
    STAGE_LABELS[j.stage],
    j.score,
    j.match?.verdict ?? '',
    j.url,
    j.deadline || j.deadlineText,
    j.followUpAt,
    j.appliedAt.slice(0, 10),
    j.sourceLabel,
    j.starred ? 'yes' : '',
    j.notes,
    j.createdAt.slice(0, 10),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Download a text file; returns false when the sandbox blocks downloads so callers can fall back to copying. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): boolean {
  try {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** All-day calendar event (.ics) for a deadline or follow-up. Works with Google, Apple and Outlook calendars. */
export function icsEvent(opts: { day: string; title: string; description: string; url: string; uid: string }): string {
  const d = opts.day.replace(/-/g, '');
  const next = new Date(opts.day + 'T12:00:00');
  next.setDate(next.getDate() + 1);
  const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//InternIQ//EN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}@interniq`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    opts.url ? `URL:${opts.url}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT12H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(opts.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

/** Google Calendar "add event" link: works even where file downloads are blocked. */
export function googleCalendarLink(opts: { day: string; title: string; details: string }): string {
  const d = opts.day.replace(/-/g, '');
  const next = new Date(opts.day + 'T12:00:00');
  next.setDate(next.getDate() + 1);
  const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: opts.title, dates: `${d}/${end}`, details: opts.details });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
