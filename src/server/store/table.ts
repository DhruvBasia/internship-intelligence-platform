/**
 * A small typed table layer over Postgres.
 *
 * - App objects use camelCase keys; columns are snake_case (or an explicit name).
 * - Every query is scoped to the current user's id, on top of row-level security.
 * - Each request reads a table at most once when it needs all rows; single-row
 *   reads hit the database directly until then. Writes go straight through.
 */
import { ctx } from '../platform/context';
import type { Filter, Row } from '../platform/db';

export type ColType = 'string' | 'number' | 'bool' | 'json' | 'date';

export interface Column {
  key: string;
  type: ColType;
  /** Column name when it differs from snake_case(key). */
  column?: string;
  /** Value stored for null/undefined JSON (for NOT NULL json columns). */
  empty?: unknown;
}

export interface TableDef {
  /** Table name in the public schema. */
  name: string;
  columns: Column[];
  /** Key whose column orders all() (insertion order matters to some views). */
  orderBy: string;
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
export const columnName = (c: Column) => c.column ?? snake(c.key);

function toDb(value: unknown, col: Column): unknown {
  switch (col.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    case 'bool':
      return value === true;
    case 'json':
      return value === null || value === undefined ? (col.empty ?? null) : value;
    case 'date': {
      if (value === null || value === undefined || value === '') return null;
      const t = Date.parse(String(value));
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

function fromDb(value: unknown, col: Column): unknown {
  switch (col.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'bool':
      return value === true || value === 'true' || value === 't';
    case 'json':
      if (value === null || value === undefined || value === '') return col.empty ?? null;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return col.empty ?? null;
        }
      }
      return value;
    case 'date': {
      if (value === null || value === undefined || value === '') return '';
      const d = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

export class Table<T extends { id: string }> {
  private rows: T[] | null = null;
  private byId: Map<string, T> | null = null;
  private readonly orderCol: string;

  constructor(readonly def: TableDef) {
    const col = def.columns.find((c) => c.key === def.orderBy);
    this.orderCol = col ? columnName(col) : 'id';
  }

  toRow(item: T): Row {
    const row: Row = { user_id: ctx().userId };
    for (const col of this.def.columns) row[columnName(col)] = toDb((item as Record<string, unknown>)[col.key], col);
    return row;
  }

  fromRow(row: Row): T {
    const out: Record<string, unknown> = {};
    for (const col of this.def.columns) out[col.key] = fromDb(row[columnName(col)], col);
    return out as T;
  }

  private scope(extra: Filter[] = []): Filter[] {
    return [{ col: 'user_id', op: 'eq', value: ctx().userId }, ...extra];
  }

  /** Every row, oldest first by the table's order column. */
  async all(): Promise<T[]> {
    if (!this.rows) {
      const raw = await ctx().db.select(this.def.name, { filters: this.scope(), order: [{ col: this.orderCol }, { col: 'id' }] });
      this.rows = raw.map((r) => this.fromRow(r));
      this.byId = new Map(this.rows.map((r) => [r.id, r]));
    }
    return this.rows;
  }

  async get(id: string): Promise<T | undefined> {
    if (this.byId) return this.byId.get(id);
    const raw = await ctx().db.select(this.def.name, { filters: this.scope([{ col: 'id', op: 'eq', value: id }]), limit: 1 });
    return raw[0] ? this.fromRow(raw[0]) : undefined;
  }

  async getMany(ids: string[]): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (!unique.length) return out;
    if (this.byId) {
      for (const id of unique) {
        const r = this.byId.get(id);
        if (r) out.set(id, r);
      }
      return out;
    }
    const raw = await ctx().db.select(this.def.name, { filters: this.scope([{ col: 'id', op: 'in', value: unique }]) });
    for (const r of raw) {
      const item = this.fromRow(r);
      out.set(item.id, item);
    }
    return out;
  }

  async has(id: string): Promise<boolean> {
    return (await this.get(id)) !== undefined;
  }

  /** Newest rows by the order column, without loading the whole table. */
  async latest(limit: number, extra: Filter[] = []): Promise<T[]> {
    if (this.rows && !extra.length) return this.rows.slice(-limit).reverse();
    const raw = await ctx().db.select(this.def.name, {
      filters: this.scope(extra),
      order: [{ col: this.orderCol, desc: true }, { col: 'id', desc: true }],
      limit,
    });
    return raw.map((r) => this.fromRow(r));
  }

  async insert(items: T[]): Promise<void> {
    if (!items.length) return;
    await ctx().db.insert(this.def.name, items.map((i) => this.toRow(i)));
    if (this.rows) {
      for (const item of items) {
        const copy = { ...item };
        this.rows.push(copy);
        this.byId!.set(copy.id, copy);
      }
    }
  }

  /** Update existing rows (rows deleted meanwhile are skipped when the table is loaded). */
  async update(items: T[]): Promise<void> {
    const list = this.byId ? items.filter((i) => this.byId!.has(i.id)) : items;
    if (!list.length) return;
    await ctx().db.upsert(this.def.name, list.map((i) => this.toRow(i)), ['user_id', 'id']);
    this.remember(list);
  }

  async upsert(items: T[]): Promise<void> {
    if (!items.length) return;
    await ctx().db.upsert(this.def.name, items.map((i) => this.toRow(i)), ['user_id', 'id']);
    this.remember(items);
  }

  private remember(items: T[]): void {
    if (!this.rows) return;
    for (const item of items) {
      const copy = { ...item };
      const existing = this.byId!.get(item.id);
      if (existing) this.rows[this.rows.indexOf(existing)] = copy;
      else this.rows.push(copy);
      this.byId!.set(item.id, copy);
    }
  }

  /** Delete by id; returns the ids that existed. */
  async remove(ids: string[]): Promise<string[]> {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (!unique.length) return [];
    const deleted = await ctx().db.delete(this.def.name, this.scope([{ col: 'id', op: 'in', value: unique }]), ['id']);
    const gone = new Set(deleted.map((r) => String(r.id)));
    if (this.rows) {
      this.rows = this.rows.filter((r) => !gone.has(r.id));
      gone.forEach((id) => this.byId!.delete(id));
    }
    return Array.from(gone);
  }

  /** Keep only the newest maxRows rows (log-style tables). */
  async trim(maxRows: number): Promise<void> {
    const extra = await ctx().db.select(this.def.name, {
      filters: this.scope(),
      columns: ['id'],
      order: [{ col: this.orderCol, desc: true }, { col: 'id', desc: true }],
      offset: maxRows,
      limit: 1000,
    });
    if (extra.length) await this.remove(extra.map((r) => String(r.id)));
  }

  async clear(): Promise<void> {
    await ctx().db.delete(this.def.name, this.scope());
    this.rows = [];
    this.byId = new Map();
  }

  /** Forget cached rows so the next read sees changes made by other requests. */
  forget(): void {
    this.rows = null;
    this.byId = null;
  }
}
