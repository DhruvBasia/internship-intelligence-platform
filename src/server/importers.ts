/**
 * Spreadsheet imports: paste from Excel/Sheets (TSV), upload CSV, the v1
 * curation format, or InternIQ's own CSV export. Pure functions.
 */
import { collapseWhitespace, safeHttpUrl, toDay, toIsoDate, truncate } from '../shared/text';
import type { Stage } from '../shared/types';
import type { RawJob } from './store/jobs';

/** RFC 4180-ish parser that also handles tab-separated pastes. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

type Field =
  | 'role'
  | 'company'
  | 'url'
  | 'location'
  | 'country'
  | 'region'
  | 'mode'
  | 'deadline'
  | 'stage'
  | 'notes'
  | 'description'
  | 'requirements'
  | 'applied'
  | 'extra';

const HEADER_RULES: [RegExp, Field][] = [
  [/^#$|^id$|^no\.?$/, 'extra'],
  [/program|opportunity|^role$|title|position/, 'role'],
  [/host org|institution|company|organi[sz]ation|employer/, 'company'],
  [/official link|^link$|^url$|apply|application link|posting/, 'url'],
  [/^location$|^city$/, 'location'],
  [/^country$/, 'country'],
  [/^region$/, 'region'],
  [/^mode$|work mode|remote/, 'mode'],
  [/deadline|due/, 'deadline'],
  [/status|stage/, 'stage'],
  [/^notes?$|comment/, 'notes'],
  [/^description$|details/, 'description'],
  [/eligib|requirement|qualification/, 'requirements'],
  [/date applied|^applied/, 'applied'],
];

function classify(header: string): Field {
  const h = header.trim().toLowerCase();
  for (const [re, field] of HEADER_RULES) if (re.test(h)) return field;
  return 'extra';
}

export function mapStage(raw: string): Stage {
  const s = raw.trim().toLowerCase();
  if (!s || /not started|discover|^new$|todo|to do/.test(s)) return 'discovered';
  if (/save|shortlist|interest|wish|plan/.test(s)) return 'saved';
  if (/interview|screen|^oa$|assessment|onsite/.test(s)) return 'interviewing';
  if (/offer|accept/.test(s)) return 'offer';
  if (/reject|declin|^no$|unsuccessful/.test(s)) return 'rejected';
  if (/archiv|withdr|closed|ghost/.test(s)) return 'archived';
  if (/appl|submit|sent/.test(s)) return 'applied';
  return 'discovered';
}

export function rowsToRawJobs(rows: string[][]): { jobs: RawJob[]; skipped: number } {
  const headerIdx = rows.findIndex((r) => r.filter((c) => classify(c) !== 'extra').length >= 2);
  if (headerIdx < 0) throw new Error('Could not find a header row with at least a role and a company column.');
  const headers = rows[headerIdx]!.map((h) => collapseWhitespace(h));
  const fields = headers.map(classify);
  if (!fields.includes('role') || !fields.includes('company')) {
    throw new Error('The header row needs a role/title/program column and a company/organisation column.');
  }
  const jobs: RawJob[] = [];
  let skipped = 0;
  for (const cells of rows.slice(headerIdx + 1)) {
    const get = (f: Field) =>
      fields
        .map((field, i) => (field === f ? collapseWhitespace(cells[i] ?? '') : ''))
        .filter(Boolean)
        .join(' · ');
    const role = get('role');
    const company = get('company');
    if (!role || !company) {
      skipped++;
      continue;
    }
    const extras = fields
      .map((f, i) => (f === 'extra' && cells[i]?.trim() && headers[i] && !/^#$|^id$/i.test(headers[i]!) ? `${headers[i]}: ${collapseWhitespace(cells[i]!)}` : ''))
      .filter(Boolean);
    const location = [get('location') || get('country'), get('mode') ? `(${get('mode')})` : ''].filter(Boolean).join(' ');
    const deadlineRaw = get('deadline');
    const deadline = /^\d{4}-\d{2}-\d{2}/.test(deadlineRaw) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(deadlineRaw) ? toDay(deadlineRaw) : '';
    const url = safeHttpUrl(get('url').split(' · ')[0]);
    jobs.push({
      source: 'import',
      sourceLabel: 'Import',
      sourceRef: '',
      url,
      company: truncate(company, 160),
      role: truncate(role, 200),
      location: truncate(location || get('region'), 200),
      description: truncate([get('description'), ...extras].filter(Boolean).join('\n'), 6000),
      requirements: truncate(get('requirements'), 3000),
      postedAt: '',
      deadline,
      deadlineText: deadline ? '' : truncate(deadlineRaw, 80),
      tags: [get('region'), get('country')].filter(Boolean).slice(0, 3),
      stage: mapStage(get('stage')),
      notes: truncate(get('notes'), 4000),
      appliedAt: toIsoDate(get('applied')),
    });
  }
  return { jobs, skipped };
}
