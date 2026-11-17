/**
 * A small, header-mapped table layer over a Google Sheet.
 *
 * - Columns are located by header name, so users can reorder columns or add
 *   their own without breaking anything (unknown columns are preserved).
 * - Each request reads a sheet at most once; writes are batched into as few
 *   setValues() calls as possible.
 * - Every text value is guarded against formula injection: scraped text that
 *   starts with "=", "+", "-" or "@" would otherwise run as a formula (e.g.
 *   =IMPORTXML could leak data when the sheet is opened).
 */
type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

export type ColType = 'string' | 'number' | 'bool' | 'json' | 'date';

export interface Column {
  key: string;
  type: ColType;
}

export interface TableDef {
  name: string;
  columns: Column[];
}

const MAX_CELL = 49_000;
const BULK_REWRITE_THRESHOLD = 12;

function guardText(s: string): string {
  const t = s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
  // Leading apostrophe forces text: blocks formulas and stops Sheets from
  // coercing ids/dates/booleans. Sheets strips it again on read.
  if (/^[=+\-@'\d]/.test(t) || /^(true|false)$/i.test(t)) return "'" + t;
  return t;
}

export function toCell(value: unknown, type: ColType): unknown {
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'bool':
      return value === true;
    case 'json':
      return value === null || value === undefined ? '' : guardText(JSON.stringify(value));
    default:
      return value === null || value === undefined ? '' : guardText(String(value));
  }
}

export function fromCell(value: unknown, type: ColType): unknown {
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'bool':
      return value === true || String(value).toLowerCase() === 'true';
    case 'json': {
      if (value === '' || value === null || value === undefined) return null;
      try {
        return JSON.parse(String(value));
      } catch {
        return null;
      }
    }
    default:
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
      return value === null || value === undefined ? '' : String(value);
  }
}

/** Create the sheet if needed and append any missing header columns. */
export function ensureTable(ss: Spreadsheet, def: TableDef): Sheet {
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) sheet = ss.insertSheet(def.name);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]!.map((h) => String(h).trim()) : [];
  const missing = def.columns.map((c) => c.key).filter((k) => !headers.includes(k));
  if (missing.length) {
    const need = headers.length + missing.length;
    const maxCols = sheet.getMaxColumns();
    if (maxCols < need) sheet.insertColumnsAfter(maxCols, need - maxCols);
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

interface RawRow {
  rowNum: number;
  values: unknown[];
}

export class Table<T extends { id: string }> {
  private headers: string[] = [];
  private rows: RawRow[] = [];
  private parsed: T[] | null = null;
  private index: Map<string, number> | null = null;
  private loaded = false;
  private readonly colIndex = new Map<string, number>();

  constructor(
    private readonly sheet: Sheet,
    private readonly def: TableDef,
  ) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const lastRow = this.sheet.getLastRow();
    const lastCol = this.sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) {
      this.headers = [];
      this.rows = [];
    } else {
      const values = this.sheet.getRange(1, 1, lastRow, lastCol).getValues();
      this.headers = values[0]!.map((h) => String(h).trim());
      this.rows = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i]!;
        if (row.every((c) => c === '' || c === null)) continue;
        this.rows.push({ rowNum: i + 1, values: row });
      }
    }
    this.colIndex.clear();
    for (const col of this.def.columns) {
      const idx = this.headers.indexOf(col.key);
      if (idx >= 0) this.colIndex.set(col.key, idx);
    }
  }

  private parse(values: unknown[]): T {
    const out: Record<string, unknown> = {};
    for (const col of this.def.columns) {
      const idx = this.colIndex.get(col.key);
      out[col.key] = fromCell(idx === undefined ? '' : values[idx], col.type);
    }
    return out as T;
  }

  private serialize(item: T, base: unknown[]): unknown[] {
    const row = base.slice();
    while (row.length < this.headers.length) row.push('');
    for (const col of this.def.columns) {
      const idx = this.colIndex.get(col.key);
      if (idx !== undefined) row[idx] = toCell((item as Record<string, unknown>)[col.key], col.type);
    }
    return row;
  }

  all(): T[] {
    this.load();
    if (!this.parsed) this.parsed = this.rows.map((r) => this.parse(r.values));
    return this.parsed;
  }

  private ids(): Map<string, number> {
    if (!this.index) {
      this.index = new Map();
      this.all().forEach((item, i) => this.index!.set(item.id, i));
    }
    return this.index;
  }

  get(id: string): T | undefined {
    const i = this.ids().get(id);
    return i === undefined ? undefined : this.all()[i];
  }

  has(id: string): boolean {
    return this.ids().has(id);
  }

  insert(items: T[]): void {
    if (!items.length) return;
    this.load();
    const width = Math.max(this.headers.length, 1);
    const values = items.map((item) => this.serialize(item, new Array(width).fill('')));
    const start = this.sheet.getLastRow() + 1;
    const needRows = start + values.length - 1;
    const maxRows = this.sheet.getMaxRows();
    if (needRows > maxRows) this.sheet.insertRowsAfter(maxRows, needRows - maxRows);
    this.sheet.getRange(start, 1, values.length, width).setValues(values);
    values.forEach((v, i) => this.rows.push({ rowNum: start + i, values: v }));
    if (this.parsed) {
      items.forEach((item) => {
        this.ids().set(item.id, this.parsed!.length);
        this.parsed!.push({ ...item });
      });
    }
  }

  update(items: T[]): void {
    if (!items.length) return;
    this.all();
    const positions: number[] = [];
    for (const item of items) {
      const i = this.ids().get(item.id);
      if (i === undefined) continue;
      const raw = this.rows[i]!;
      raw.values = this.serialize(item, raw.values);
      this.parsed![i] = { ...item };
      positions.push(i);
    }
    if (!positions.length) return;
    const width = this.headers.length;
    if (positions.length >= BULK_REWRITE_THRESHOLD) {
      // One write covering the span of touched rows is far cheaper than many small ones.
      const first = Math.min(...positions.map((p) => this.rows[p]!.rowNum));
      const last = Math.max(...positions.map((p) => this.rows[p]!.rowNum));
      const block: unknown[][] = Array.from({ length: last - first + 1 }, () => new Array(width).fill(''));
      for (const r of this.rows) {
        if (r.rowNum >= first && r.rowNum <= last) block[r.rowNum - first] = r.values.slice(0, width);
      }
      this.sheet.getRange(first, 1, block.length, width).setValues(block);
    } else {
      for (const p of positions) {
        const r = this.rows[p]!;
        this.sheet.getRange(r.rowNum, 1, 1, width).setValues([r.values.slice(0, width)]);
      }
    }
  }

  upsert(items: T[]): void {
    const existing = items.filter((i) => this.has(i.id));
    const fresh = items.filter((i) => !this.has(i.id));
    this.update(existing);
    this.insert(fresh);
  }

  remove(ids: string[]): string[] {
    this.all();
    const doomed = new Set(ids.filter((id) => this.has(id)));
    if (!doomed.size) return [];
    const keep = this.rows.filter((_, i) => !doomed.has(this.parsed![i]!.id));
    const width = this.headers.length;
    // Sheets refuses to delete every non-frozen row, so emptying a table always rewrites.
    if (doomed.size >= BULK_REWRITE_THRESHOLD || keep.length === 0) {
      const lastRow = this.sheet.getLastRow();
      if (lastRow > 1) this.sheet.getRange(2, 1, lastRow - 1, width).clearContent();
      if (keep.length) this.sheet.getRange(2, 1, keep.length, width).setValues(keep.map((r) => r.values.slice(0, width)));
    } else {
      const rowNums = this.rows.filter((_, i) => doomed.has(this.parsed![i]!.id)).map((r) => r.rowNum);
      rowNums.sort((a, b) => b - a).forEach((n) => this.sheet.deleteRow(n));
    }
    this.loaded = false;
    this.parsed = null;
    this.index = null;
    return Array.from(doomed);
  }

  /** Delete the oldest data rows when a log-style table grows past maxRows. */
  trim(maxRows: number, dropCount: number): void {
    const lastRow = this.sheet.getLastRow();
    if (lastRow - 1 > maxRows) {
      this.sheet.deleteRows(2, Math.min(dropCount, lastRow - 2));
      this.loaded = false;
      this.parsed = null;
      this.index = null;
    }
  }

  clear(): void {
    const lastRow = this.sheet.getLastRow();
    const lastCol = this.sheet.getLastColumn();
    if (lastRow > 1 && lastCol > 0) this.sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    this.loaded = false;
    this.parsed = null;
    this.index = null;
  }
}
