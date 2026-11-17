import type { JobSummary, Verdict } from '../../shared/types';

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function relTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return '';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf ? rtf.format(Math.round(diff / secs), unit) : `${Math.round(abs / secs)} ${unit}s`;
  }
  return 'just now';
}

export function shortDate(isoOrDay: string): string {
  if (!isoOrDay) return '';
  const d = new Date(isoOrDay.length === 10 ? isoOrDay + 'T12:00:00' : isoOrDay);
  if (Number.isNaN(d.getTime())) return isoOrDay;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Days from today until a YYYY-MM-DD date (negative = past). */
export function daysUntil(day: string): number {
  if (!day) return NaN;
  const target = new Date(day.slice(0, 10) + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(day: string): string {
  const n = daysUntil(day);
  if (Number.isNaN(n)) return '';
  if (n < 0) return `${-n}d overdue`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n < 14) return `in ${n}d`;
  return shortDate(day);
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function todayDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = { strong: 'Strong fit', good: 'Good fit', stretch: 'Stretch', weak: 'Weak fit' };

export function verdictOf(job: Pick<JobSummary, 'match' | 'score'>): Verdict {
  if (job.match?.verdict) return job.match.verdict;
  const s = job.score;
  return s >= 80 ? 'strong' : s >= 65 ? 'good' : s >= 50 ? 'stretch' : 'weak';
}

export function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}
