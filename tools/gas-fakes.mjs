/**
 * In-memory fakes of the Apps Script services InternIQ uses, faithful enough to
 * run the real server bundle in Node (dev harness and integration tests).
 *
 * Fidelity notes:
 * - Sheets: values are stored as typed cells; a leading apostrophe forces text
 *   and is stripped on read (as in Sheets). Unguarded strings that look like
 *   numbers/booleans are coerced, so tests catch missing guards.
 * - Deleting every non-frozen row throws, as real Sheets does.
 * - UrlFetchApp is synchronous; `fetchImpl(request)` decides the response.
 */

let idSeq = 0;
const nextId = (p) => `${p}${(++idSeq).toString(36).padStart(6, '0')}`;

function coerce(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^=/.test(v)) return `#FORMULA(${v})`;
  return v;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
    if (row < 1 || col < 1 || row + numRows - 1 > sheet.maxRows || col + numCols - 1 > sheet.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) row.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(row);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : String(v))));
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error(`The number of rows/columns in the data does not match the range (${values.length}x${values[0]?.length} vs ${this.numRows}x${this.numCols}).`);
    }
    values.forEach((r, i) => r.forEach((v, j) => this.sheet.setCell(this.row + i, this.col + j, coerce(v))));
    return this;
  }
  setValue(v) {
    this.sheet.setCell(this.row, this.col, coerce(v));
    return this;
  }
  getValue() {
    return this.sheet.cell(this.row, this.col);
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.setCell(this.row + r, this.col + c, '');
    return this;
  }
  setFontWeight() {
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.maxRows = 1000;
    this.maxCols = 26;
    this.frozen = 0;
  }
  cell(r, c) {
    return this.rows[r - 1]?.[c - 1] ?? '';
  }
  setCell(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getName() {
    return this.name;
  }
  setName(n) {
    this.name = n;
    return this;
  }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some((v) => v !== '' && v !== null)) return i;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const r of this.rows) for (let i = r.length; i > max; i--) if (r[i - 1] !== '' && r[i - 1] !== null) max = i;
    return max;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  insertColumnsAfter(_after, n) {
    this.maxCols += n;
    return this;
  }
  insertRowsAfter(_after, n) {
    this.maxRows += n;
    return this;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    values.forEach((v, i) => this.setCell(r, i + 1, coerce(v)));
    return this;
  }
  deleteRow(n) {
    return this.deleteRows(n, 1);
  }
  deleteRows(start, count) {
    if (this.maxRows - count <= this.frozen) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    this.rows.splice(start - 1, count);
    this.maxRows -= count;
    return this;
  }
  setFrozenRows(n) {
    this.frozen = n;
    return this;
  }
}

class FakeSpreadsheet {
  constructor(name) {
    this.id = nextId('ss');
    this.name = name;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getUrl() {
    return `https://docs.google.com/spreadsheets/d/${this.id}/edit`;
  }
  getSheetByName(n) {
    return this.sheets.find((s) => s.name === n) ?? null;
  }
  getSheets() {
    return this.sheets.slice();
  }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
    const s = new FakeSheet(n);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(s) {
    this.sheets = this.sheets.filter((x) => x !== s);
  }
}

class FakeProperties {
  constructor(store) {
    this.store = store;
  }
  getProperty(k) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setProperty(k, v) {
    const s = String(v);
    if (Buffer.byteLength(s, 'utf8') > 9 * 1024) throw new Error(`Argument too large: value for ${k}`);
    this.store[k] = s;
    return this;
  }
  setProperties(obj) {
    for (const [k, v] of Object.entries(obj)) this.setProperty(k, v);
    return this;
  }
  deleteProperty(k) {
    delete this.store[k];
    return this;
  }
  getKeys() {
    return Object.keys(this.store);
  }
  getProperties() {
    return { ...this.store };
  }
  deleteAllProperties() {
    for (const k of Object.keys(this.store)) delete this.store[k];
    return this;
  }
}

class FakeResponse {
  constructor(status, text, headers = {}) {
    Object.assign(this, { status, text, headers });
  }
  getResponseCode() {
    return this.status;
  }
  getContentText() {
    return this.text;
  }
  getHeaders() {
    return this.headers;
  }
}

/**
 * Build a fresh set of globals.
 * @param {{ fetchImpl?: (req: {url:string, method:string, headers:object, payload?:string}) => {status:number, text:string, headers?:object}, email?: string, state?: object }} opts
 */
export function createGasGlobals(opts = {}) {
  const state = opts.state ?? { props: {}, spreadsheets: [], triggers: [], mail: [], fetches: [], cache: new Map() };
  if (!state.cache) state.cache = new Map();
  const fetchImpl = opts.fetchImpl ?? (() => ({ status: 404, text: 'not found' }));
  const email = opts.email ?? 'student@example.com';

  const doFetch = (url, params = {}) => {
    const req = { url, method: (params.method ?? 'get').toLowerCase(), headers: params.headers ?? {}, payload: params.payload };
    state.fetches.push({ url, method: req.method });
    const res = fetchImpl(req);
    if (res && res.throws) throw new Error(res.throws);
    return new FakeResponse(res.status, res.text ?? '', res.headers ?? {});
  };

  const findSpreadsheet = (id) => state.spreadsheets.find((s) => s.getId() === id);

  const globals = {
    SpreadsheetApp: {
      create(name) {
        const ss = new FakeSpreadsheet(name);
        state.spreadsheets.push(ss);
        return ss;
      },
      openById(id) {
        const ss = findSpreadsheet(id);
        if (!ss) throw new Error('Requested entity was not found.');
        return ss;
      },
      openByUrl(url) {
        const m = /\/d\/([^/]+)/.exec(url);
        const ss = m && findSpreadsheet(m[1]);
        if (!ss) throw new Error('Requested entity was not found.');
        return ss;
      },
    },
    PropertiesService: {
      getUserProperties: () => new FakeProperties(state.props),
      getScriptProperties: () => new FakeProperties((state.scriptProps ??= {})),
    },
    CacheService: {
      getUserCache: () => ({
        get: (k) => {
          const e = state.cache.get(k);
          return e && e.until > Date.now() ? e.v : null;
        },
        put: (k, v, ttl = 600) => void state.cache.set(k, { v: String(v), until: Date.now() + ttl * 1000 }),
        remove: (k) => void state.cache.delete(k),
      }),
    },
    LockService: {
      getUserLock: () => {
        let held = false;
        return {
          tryLock: () => {
            if (state.lockHeld) return false;
            state.lockHeld = held = true;
            return true;
          },
          waitLock() {
            if (!this.tryLock()) throw new Error('Lock timeout');
          },
          releaseLock: () => {
            if (held) state.lockHeld = held = false;
          },
          hasLock: () => held,
        };
      },
    },
    UrlFetchApp: {
      fetch: (url, params) => doFetch(url, params),
      fetchAll: (reqs) => reqs.map((r) => doFetch(r.url, r)),
    },
    MailApp: {
      sendEmail: (msg) => void state.mail.push(msg),
      getRemainingDailyQuota: () => 100 - state.mail.length,
    },
    ScriptApp: {
      getProjectTriggers: () =>
        state.triggers.map((t) => ({ getHandlerFunction: () => t.handler, getUniqueId: () => t.id, _t: t })),
      deleteTrigger: (trig) => {
        state.triggers = state.triggers.filter((t) => t.id !== trig.getUniqueId());
      },
      newTrigger: (handler) => {
        const spec = { handler, id: nextId('tr') };
        const builder = {
          timeBased: () => builder,
          everyHours: (n) => ((spec.everyHours = n), builder),
          everyDays: (n) => ((spec.everyDays = n), builder),
          atHour: (h) => ((spec.atHour = h), builder),
          create: () => (state.triggers.push(spec), spec),
        };
        return builder;
      },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/DEV/exec' }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => email }),
      getEffectiveUser: () => ({ getEmail: () => email }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => undefined,
      formatDate: (date, tz, fmt) => {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' })
            .formatToParts(date)
            .map((p) => [p.type, p.value]),
        );
        return fmt.replace("yyyy-MM-dd'|'H", `${parts.year}-${parts.month}-${parts.day}|${Number(parts.hour)}`);
      },
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: (name) => ({ getContent: () => (opts.htmlFiles ?? {})[name] ?? '' }),
      createHtmlOutput: (html) => {
        const out = {
          html,
          title: '',
          getContent: () => out.html,
          setTitle: (t) => ((out.title = t), out),
          addMetaTag: () => out,
          setXFrameOptionsMode: (m) => ((out.xframe = m), out),
        };
        return out;
      },
    },
  };
  return { globals, state };
}
