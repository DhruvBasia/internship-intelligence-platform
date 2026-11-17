/**
 * Each user's data lives in a spreadsheet in *their own* Google Drive (the web
 * app runs as the user accessing it), so nobody else, including the app
 * owner, can read it. The spreadsheet id is kept in that user's properties.
 */
import type { ActivityEntry, Job, JobSummary } from '../../shared/types';
import { props, withUserLock } from '../gas';
import { log } from '../log';
import { ensureTable, Table, type TableDef } from './table';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

/** Same property name v1 used, so an in-place upgrade finds the user's existing sheet. */
const PROP_SHEET_ID = 'SPREADSHEET_ID';
const PROP_SCHEMA = 'iip.schema';
export const SCHEMA_VERSION = '2.0';
const SHEET_TITLE = 'InternIQ: my internship tracker';

/** Row shape of the lean "Jobs" sheet, read on almost every request. */
export type JobRow = JobSummary & { canonicalUrl: string; roleKey: string };

/** Heavy text lives separately so list views never read it. */
export interface JobTextRow {
  id: string;
  description: string;
  requirements: string;
  local: Job['local'];
  /** When we last tried to fetch a fuller description from the posting page. */
  enrichedAt?: string;
}

export interface DocRow {
  id: string;
  coverLetter: string;
  updatedAt: string;
}

export const JOBS: TableDef = {
  name: 'Jobs',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'company', type: 'string' },
    { key: 'role', type: 'string' },
    { key: 'location', type: 'string' },
    { key: 'workMode', type: 'string' },
    { key: 'stage', type: 'string' },
    { key: 'score', type: 'number' },
    { key: 'starred', type: 'bool' },
    { key: 'url', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'sourceLabel', type: 'string' },
    { key: 'sourceRef', type: 'string' },
    { key: 'tags', type: 'json' },
    { key: 'postedAt', type: 'date' },
    { key: 'deadline', type: 'string' },
    { key: 'deadlineText', type: 'string' },
    { key: 'stageChangedAt', type: 'date' },
    { key: 'appliedAt', type: 'date' },
    { key: 'followUpAt', type: 'string' },
    { key: 'notes', type: 'string' },
    { key: 'snippet', type: 'string' },
    { key: 'match', type: 'json' },
    { key: 'aiStatus', type: 'string' },
    { key: 'aiError', type: 'string' },
    { key: 'aiAttempts', type: 'number' },
    { key: 'canonicalUrl', type: 'string' },
    { key: 'roleKey', type: 'string' },
    { key: 'createdAt', type: 'date' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const JOB_TEXT: TableDef = {
  name: 'JobText',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'description', type: 'string' },
    { key: 'requirements', type: 'string' },
    { key: 'local', type: 'json' },
    { key: 'enrichedAt', type: 'date' },
  ],
};

export const DOCS: TableDef = {
  name: 'CoverLetters',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'coverLetter', type: 'string' },
    { key: 'updatedAt', type: 'date' },
  ],
};

export const ACTIVITY: TableDef = {
  name: 'Activity',
  columns: [
    { key: 'id', type: 'string' },
    { key: 'at', type: 'date' },
    { key: 'jobId', type: 'string' },
    { key: 'type', type: 'string' },
    { key: 'message', type: 'string' },
  ],
};

const ALL_TABLES = [JOBS, JOB_TEXT, DOCS, ACTIVITY];

interface RequestState {
  ss: Spreadsheet | null;
  tables: Map<string, Table<{ id: string }>>;
  pendingActivity: ActivityEntry[];
}

let state: RequestState = { ss: null, tables: new Map(), pendingActivity: [] };

/**
 * Apps Script starts every call with fresh globals, but the local dev harness
 * reuses one context, so each entry point resets explicitly.
 */
export function resetRequestState(): void {
  state = { ss: null, tables: new Map(), pendingActivity: [] };
}

function openStored(): Spreadsheet | null {
  const id = props.get(PROP_SHEET_ID);
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    log.warn('sheet.open_failed', { message: String(e) });
    return null;
  }
}

function setupSchema(ss: Spreadsheet): void {
  for (const def of ALL_TABLES) ensureTable(ss, def);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  props.set(PROP_SCHEMA, SCHEMA_VERSION);
}

export function hasSpreadsheet(): boolean {
  return Boolean(props.get(PROP_SHEET_ID));
}

export function spreadsheet(): Spreadsheet {
  if (state.ss) return state.ss;
  let ss = openStored();
  if (!ss) {
    ss = withUserLock(() => {
      // Another request may have created it while we waited for the lock.
      const again = openStored();
      if (again) return again;
      const created = SpreadsheetApp.create(SHEET_TITLE);
      props.set(PROP_SHEET_ID, created.getId());
      props.del(PROP_SCHEMA);
      log.info('sheet.created');
      return created;
    });
  }
  if (props.get(PROP_SCHEMA) !== SCHEMA_VERSION) withUserLock(() => setupSchema(ss!));
  state.ss = ss;
  return ss;
}

export function table<T extends { id: string }>(def: TableDef): Table<T> {
  const cached = state.tables.get(def.name);
  if (cached) return cached as unknown as Table<T>;
  const ss = spreadsheet();
  const sheet = ss.getSheetByName(def.name) ?? ensureTable(ss, def);
  const t = new Table<T>(sheet, def);
  state.tables.set(def.name, t as unknown as Table<{ id: string }>);
  return t;
}

/**
 * Forget cached sheet reads. Call right after taking the lock when work done
 * outside the lock (network, AI) must be merged onto the latest data.
 */
export function dropTableCache(): void {
  state.tables = new Map();
}

export function queueActivity(entry: ActivityEntry): void {
  state.pendingActivity.push(entry);
}

/** Write buffered activity in one call. Never throws: logging must not break a request. */
export function flushActivity(): void {
  const pending = state.pendingActivity;
  if (!pending.length) return;
  state.pendingActivity = [];
  try {
    // Appends compute their start row from getLastRow(), so two executions
    // writing at once could overwrite each other's rows: serialise them.
    withUserLock(() => {
      state.tables.delete(ACTIVITY.name);
      const t = table<ActivityEntry>(ACTIVITY);
      t.insert(pending);
      t.trim(3000, 1000);
    }, 5_000);
  } catch (e) {
    log.warn('activity.flush_failed', { message: String(e) });
  }
}

export function sheetUrl(): string {
  try {
    return spreadsheet().getUrl();
  } catch {
    return '';
  }
}

/** Forget the spreadsheet (used by "delete my data"); the file itself stays in the user's Drive. */
export function forgetSpreadsheet(): void {
  props.del(PROP_SHEET_ID);
  props.del(PROP_SCHEMA);
  resetRequestState();
}
