/** Pure string helpers shared by server, client and tests. No platform APIs. */

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  bull: '•',
  middot: '·',
};

export function decodeEntities(input: string): string {
  if (!input) return '';
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(n);
      } catch {
        return whole;
      }
    }
    const mapped = ENTITY_MAP[code.toLowerCase()];
    return mapped === undefined ? whole : mapped;
  });
}

/** Convert HTML (possibly entity-escaped HTML, as Greenhouse returns) into readable plain text. */
export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html;
  // Greenhouse double-escapes its HTML; decode once if it looks escaped.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

export function collapseWhitespace(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are ever rendered as links or fetched. Returns '' for anything else. */
export function safeHttpUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  if (/[\s<>"'`]/.test(s)) return '';
  const host = urlHost(s);
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return '';
  return s;
}

export function urlHost(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || '');
  if (!m) return '';
  const authority = m[1]!;
  const at = authority.lastIndexOf('@');
  return (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
}

const TRACKING_PARAMS = /^(utm_[a-z]+|gh_src|lever-source(\[\])?|lever-origin|source|src|ref|referrer|trk|trackingid|fbclid|gclid|mc_[a-z]+|_hs[a-z]+|hss_channel|campaign|iis|iisn)$/i;

/** Canonical form used for de-duplication: lower-case host, no www, no tracking params, no hash/trailing slash. */
export function canonicalUrl(raw: string): string {
  const url = safeHttpUrl(raw);
  if (!url) return '';
  const m = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(url);
  if (!m) return '';
  const host = urlHost(url).replace(/^www\./, '');
  let path = (m[2] || '').replace(/\/+$/, '');
  try {
    path = decodeURI(path);
  } catch {
    /* keep raw path */
  }
  const params = (m[3] || '')
    .replace(/^\?/, '')
    .split('&')
    .filter((p) => p && !TRACKING_PARAMS.test(p.split('=')[0] || ''))
    .sort();
  return host + path + (params.length ? '?' + params.join('&') : '');
}

/** Lower-case, accent-free, punctuation-free text for fuzzy comparisons. */
export function normalizeKey(s: string): string {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

/** Company + role key, ignoring seasons/years and boilerplate so reposts collapse together. */
export function roleKey(company: string, role: string): string {
  const c = normalizeKey(company)
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const r = normalizeKey(role)
    .replace(/\b(summer|fall|autumn|winter|spring|20\d\d|intern(ship)?s?|co op|coop|program(me)?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return c + '|' + r;
}

/** Split a comma/newline/semicolon list into trimmed unique items, preserving first-seen casing. */
export function splitList(input: string | string[] | null | undefined, max = 50): string[] {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n|]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const item = collapseWhitespace(String(part));
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** 32-bit FNV-1a, hex. Stable across runtimes; used for change detection, not security. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Word-boundary regex for a phrase. Handles tokens with symbols (C++, C#, .NET, Node.js)
 * where \b does not work.
 */
export function phraseRegExp(phrase: string, flags = 'i'): RegExp {
  const escaped = escapeRegExp(phrase.trim()).replace(/\s+/g, '[\\s\\-/]+');
  return new RegExp('(?:^|[^a-z0-9+#.])' + escaped + '(?![a-z0-9+#])', flags);
}

/** Parse many date shapes into an ISO string, or '' when unknown. Unix seconds and ms are both accepted. */
export function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const s = String(value).trim();
  if (/^\d{10,13}$/.test(s)) return toIsoDate(Number(s));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return '';
  return d.toISOString();
}

/** YYYY-MM-DD for a date-like value, or ''. */
export function toDay(value: unknown): string {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : '';
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return (b - a) / 86_400_000;
}
