/**
 * Upgrading from v1 (single-user Apps Script app).
 *
 * In-place: if v2 is pushed to the same Apps Script project, the user's v1
 * spreadsheet id is still in their properties. Its v1 sheets are converted
 * once and kept as renamed backups. The v1 Gemini key and profile carry over.
 *
 * From a URL: any user can import a v1 (or v2) spreadsheet they have access to.
 */
import { collapseWhitespace, roleKey, safeHttpUrl, splitList, toDay, toIsoDate, truncate } from '../shared/text';
import type { ImportResult } from '../shared/types';
import { AppError } from './errors';
import { props } from './gas';
import { log } from './log';
import { mapStage, rowsToRawJobs } from './importers';
import { spreadsheet, type DocRow } from './store/db';
import { docsTable, insertRawJobs, jobsTable, logActivity, toSummary, type RawJob } from './store/jobs';
import { getProfile, getSettings, getV1Migrated, saveProfile, saveSettings, setSecret, setV1Migrated } from './store/userState';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

const V1_MARKERS = ['AIMatchScore', 'AIRationale'];

function isV1Jobs(sheet: Sheet | null): boolean {
  if (!sheet || sheet.getLastColumn() < 1) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]!.map(String);
  return V1_MARKERS.every((m) => headers.includes(m));
}

function v1Jobs(sheet: Sheet): { raws: RawJob[]; legacyIds: Map<string, string> } {
  const values = sheet.getDataRange().getValues();
  const headers = values[0]!.map((h) => String(h).trim());
  const col = (name: string) => headers.indexOf(name);
  const cell = (row: unknown[], name: string): unknown => (col(name) >= 0 ? row[col(name)] : '');
  const text = (row: unknown[], name: string) => collapseWhitespace(String(cell(row, name) ?? ''));
  const raws: RawJob[] = [];
  const legacyIds = new Map<string, string>();
  for (const row of values.slice(1)) {
    const role = text(row, 'Role');
    const company = text(row, 'Company');
    if (!role || !company) continue;
    const score = Number(cell(row, 'AIMatchScore')) || 0;
    const rationale = String(cell(row, 'AIRationale') ?? '').trim();
    const deadlineCell = cell(row, 'Deadline');
    const deadline = deadlineCell instanceof Date ? toDay(deadlineCell) : '';
    const notes = [
      String(cell(row, 'Notes') ?? '').trim(),
      score > 0 && rationale && !/^AI model skipped|^Error calculating/i.test(rationale) ? `v1 AI score ${score}/100:\n${rationale}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const status = text(row, 'Status');
    raws.push({
      source: 'import',
      sourceLabel: 'v1 · ' + (text(row, 'Source') || 'tracker'),
      sourceRef: text(row, 'ID'),
      url: safeHttpUrl(text(row, 'URL')),
      company,
      role,
      location: text(row, 'Location'),
      description: String(cell(row, 'Description') ?? ''),
      requirements: String(cell(row, 'Requirements') ?? ''),
      postedAt: toIsoDate(cell(row, 'DateAdded')),
      deadline,
      deadlineText: deadline ? '' : truncate(text(row, 'Deadline'), 80),
      tags: [],
      stage: /^offered?$/i.test(status) ? 'offer' : mapStage(status),
      notes,
      appliedAt: toIsoDate(cell(row, 'AppliedDate')),
    });
    legacyIds.set(roleKey(company, role), text(row, 'ID'));
  }
  return { raws, legacyIds };
}

function v1Letters(ss: Spreadsheet): Map<string, string> {
  const out = new Map<string, string>();
  const sheet = ss.getSheetByName('Applications');
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet
    .getDataRange()
    .getValues()
    .slice(1)
    .forEach((r) => {
      const text = String(r[1] ?? '').trim();
      if (r[0] && text && !/^Error generating/i.test(text)) out.set(String(r[0]), text);
    });
  return out;
}

function insertWithLetters(raws: RawJob[], legacyIds: Map<string, string>, letters: Map<string, string>): number {
  const profile = getProfile();
  const rows = insertRawJobs(raws, profile, { activity: 'import' });
  const docs: DocRow[] = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const legacy = legacyIds.get(row.roleKey);
    const letter = legacy ? letters.get(legacy) : undefined;
    if (letter) docs.push({ id: row.id, coverLetter: letter, updatedAt: now });
  }
  if (docs.length) docsTable().upsert(docs);
  return rows.length;
}

function migrateV1Profile(ss: Spreadsheet): void {
  const sheet = ss.getSheetByName('UserProfile');
  const current = getProfile();
  if (sheet && sheet.getLastRow() > 1 && !current.skills.length && !current.resumeText) {
    const kv = new Map(sheet.getDataRange().getValues().slice(1).map((r) => [String(r[0]), String(r[1] ?? '')]));
    saveProfile({
      ...current,
      name: kv.get('name') || current.name,
      skills: splitList(kv.get('skills')),
      targetRoles: splitList(kv.get('target_roles')),
      resumeText: kv.get('resume_text') || '',
    });
    const threshold = Number(kv.get('alert_threshold'));
    if (threshold) saveSettings({ automation: { digestThreshold: threshold } });
  }
  // v1 stored the Gemini key under this property name, in the same per-user store.
  const legacyKey = (props.get('GEMINI_API_KEY') || '').trim();
  if (legacyKey && legacyKey.length < 100) {
    setSecret('gemini', legacyKey);
    if (getSettings().ai.provider === 'none') saveSettings({ ai: { provider: 'gemini' } });
    props.del('GEMINI_API_KEY');
  }
}

export function hasV1Data(): boolean {
  if (getV1Migrated()) return false;
  try {
    return isV1Jobs(spreadsheet().getSheetByName('Internships'));
  } catch {
    return false;
  }
}

/** One-time conversion of v1 sheets in the user's existing spreadsheet. Caller holds the lock. */
export function migrateV1InPlace(): number {
  const ss = spreadsheet();
  const sheet = ss.getSheetByName('Internships');
  if (!isV1Jobs(sheet)) return 0;
  const { raws, legacyIds } = v1Jobs(sheet!);
  const count = insertWithLetters(raws, legacyIds, v1Letters(ss));
  migrateV1Profile(ss);
  for (const name of ['Internships', 'Applications', 'UserProfile', 'ActivityLog']) {
    const s = ss.getSheetByName(name);
    if (s) s.setName(`v1 backup · ${name}`);
  }
  setV1Migrated(Math.max(count, 1));
  logActivity('', 'import', `Upgraded from v1: ${count} jobs carried over (old sheets kept as backups)`);
  log.info('migrate.v1', { count });
  return count;
}

export function importFromSheetUrl(url: string): ImportResult {
  const safe = safeHttpUrl(url);
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(safe)) {
    throw new AppError('BAD_INPUT', 'Paste the link of a Google Sheet (docs.google.com/spreadsheets/...).');
  }
  let ss: Spreadsheet;
  try {
    ss = SpreadsheetApp.openByUrl(safe);
  } catch {
    throw new AppError('NOT_FOUND', "Couldn't open that sheet. Make sure your Google account can view it.");
  }
  if (ss.getId() === spreadsheet().getId()) throw new AppError('BAD_INPUT', 'That is your current InternIQ sheet.');
  let added = 0;
  let skipped = 0;
  const v1 = ss.getSheetByName('Internships') ?? ss.getSheetByName('v1 backup · Internships');
  if (isV1Jobs(v1)) {
    const { raws, legacyIds } = v1Jobs(v1!);
    added = insertWithLetters(raws, legacyIds, v1Letters(ss));
    skipped = raws.length - added;
  } else {
    const sheet = ss.getSheetByName('Jobs') ?? ss.getSheets()[0]!;
    const values = sheet.getDataRange().getDisplayValues();
    const parsed = rowsToRawJobs(values);
    added = insertRawJobs(parsed.jobs, getProfile(), { activity: 'import' }).length;
    skipped = parsed.skipped + parsed.jobs.length - added;
  }
  logActivity('', 'import', `Imported ${added} jobs from "${ss.getName()}"`);
  return { added, skipped, jobs: jobsTable().all().map(toSummary) };
}
