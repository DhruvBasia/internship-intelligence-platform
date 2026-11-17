/**
 * Email triage, pure and deterministic. Ported from the "Placement Tracker"
 * routine (same queries, noise rules and stage mapping) and extended to study
 * admissions, government exams and generic deadlines.
 */
import { collapseWhitespace, normalizeKey, truncate } from '../../shared/text';
import type { Area, MailCategory, Stage } from '../../shared/types';

export interface RawMail {
  id: string;
  threadId: string;
  /** Raw From header, e.g. `Acme Careers <jobs@acme.com>`. */
  from: string;
  subject: string;
  /** ISO timestamp. */
  date: string;
  snippet: string;
  body: string;
}

export interface Classification {
  category: MailCategory;
  area: Area;
  noise: boolean;
  important: boolean;
  company: string;
  role: string;
  due: string;
  allDay: boolean;
  suggestedStage: Stage | '';
  taskTitle: string;
  fromName: string;
  fromAddress: string;
}

/** College placement cell / POD senders (GGSIPU) and job platforms. */
export const PLACEMENT_SENDERS = ['cpc@ipu.ac.in', 'placements.edc@ipu.ac.in', 'notifications@pod.ai', 'kodnest.com', 'internshala.com', 'naukri.com', 'monsterindia.com', 'jobs-noreply@linkedin.com'];
const ATS_DOMAINS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkday(jobs)?\.com|workday\.com|smartrecruiters\.com|icims\.com|successfactors|taleo\.net|oraclecloud\.com|hackerrank\.com|hackerearth\.com|codility\.com|mettl\.com|codesignal\.com|unstop\.com|superset\.com|pod\.ai)$/i;
const EXAM_DOMAINS = /(upsc\.gov\.in|ssc\.gov\.in|ssc\.nic\.in|nta\.ac\.in|nta\.nic\.in|ibps\.in|rbi\.org\.in|dsssb|joinindianarmy|joinindiannavy|careerairforce|gate\.iit|isro\.gov\.in|sebi\.gov\.in)/i;
const UNIVERSITY_DOMAIN = /(\.edu|\.ac\.(uk|ae|jp|kr|nz|za|at|be)|\.edu\.[a-z]{2}|uni-[a-z]+\.de|tu-[a-z]+\.de|\.uni\.[a-z]+|mbzuai\.ac\.ae|kaust\.edu\.sa|uni-assist\.de|daad\.de|erasmus|\.ac\.ae)$/i;
const PLATFORM_DOMAINS = /^(gmail|googlemail|outlook|hotmail|yahoo|icloud|linkedin|naukri|internshala|pod|ipu|greenhouse|lever|ashbyhq|myworkday|myworkdayjobs|workday|smartrecruiters|icims|hackerrank|hackerearth|codility|mettl|codesignal|unstop|superset|google|microsoft)$/i;

const NOISE: RegExp[] = [
  /\botp\b|one[- ]time password|verification code|verify your (email|account)|password reset|confirm your email/i,
  /job alert|jobs? you (may|might) (be interested|like)|recommended jobs|jobs you haven'?t applied|new jobs (for|matching)|is hiring:|people (are )?viewing|weekly digest|newsletter|top picks for you/i,
  /webinar|masterclass|expert session|free workshop|\d+% off|discount|sale ends|limited[- ]time offer|enroll now|early bird/i,
  /cogniza|shikshavertex|corizo|training (&|and) internship program|ibm[- ]associated|paid (training|internship) program|internship certificate program/i,
];

const RULES: [MailCategory, RegExp][] = [
  ['offer', /offer letter|pleased to (extend|offer)|offer of (employment|internship)|congratulations[^.]{0,100}(offer|selected for)|you have been selected/i],
  ['rejected', /regret to inform|not (be )?moving forward|unfortunately[^.]{0,140}(not|unable|won'?t)|cannot proceed|not been (selected|shortlisted|successful)|decided to (move|proceed) with other|position has been filled|will not be progressing|unable to offer you/i],
  ['on-hold', /\bon hold\b|been paused|(process|role|hiring|position) (is|has been) paused/i],
  ['interview', /\binterviews?\b|shortlisted|next round|technical round|\bhr round\b|(placement|recruitment|hiring|campus) drive|schedule (a|your) (call|chat)|calendly\.com/i],
  ['assessment', /assessment|online test|coding (test|challenge|round|exercise)|hackerrank|hackerearth|codility|mettl|codesignal|aptitude test|take[- ]home|\boa\b link|test link/i],
  ['applied', /application (has been )?(received|submitted|complete)|thank(s| you) for (applying|your application|your interest in)|your application (to|for|was|has)|application was sent|we('ve| have) received your application/i],
  ['eligible', /you are eligible|eligible (students|candidates)|register (for|before|by)|registration (link|is open|open|closes)|apply (now|before|by)|job (opening|opportunity) for/i],
  ['exam', /admit card|hall ticket|exam (city|centre|center|date|schedule)|\bupsc\b|ssc (cgl|chsl|cpo)|gate 20\d\d|ugc[- ]net|\bibps\b|rbi grade|\bdsssb\b|\bafcat\b|\bcds\b exam/i],
  ['admissions', /admission|application portal|uni-assist|erasmus|scholarship|\bdaad\b|statement of purpose|recommendation letter|letter of recommendation|referee|graduate (program|programme)|master'?s (program|programme|degree)|phd (program|programme|position)|\bmbzuai\b|\bkaust\b|\bielts\b|\btoefl\b|\baps\b certificate/i],
  ['deadline', /deadline|last date|due (date|by|on)|submit (it )?by|before the (deadline|end of)|reminder:|expires? (on|in)/i],
];

const STAGE_FOR: Partial<Record<MailCategory, Stage>> = {
  eligible: 'saved',
  applied: 'applied',
  assessment: 'interviewing',
  interview: 'interviewing',
  offer: 'offer',
  rejected: 'rejected',
};

export function parseFrom(header: string): { name: string; address: string; domain: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header || '');
  const address = (m ? m[2]! : header || '').trim().toLowerCase();
  const name = m ? m[1]!.trim() : '';
  return { name, address, domain: address.split('@')[1] ?? '' };
}

function senderMatches(address: string, list: string[]): boolean {
  return list.some((s) => (s.includes('@') ? address === s : address.endsWith('@' + s) || address.endsWith('.' + s)));
}

const COMPANY_STOP = /\b(careers?|recruiting|recruitment|recruiter|talent( acquisition)?|hiring( team)?|team|jobs|hr|people|university relations|campus|no-?reply|notifications?|via [\w .]+)\b/gi;

function cleanCompany(s: string): string {
  const c = collapseWhitespace(s.replace(COMPANY_STOP, ' ').replace(/[|·•:–—-]+$/g, '').replace(/^[|·•:–—-]+/g, ''));
  if (c.length < 2 || c.length > 50 || /^(the|your|our|a|an|you|we)$/i.test(c)) return '';
  return c;
}

/**
 * Company behind an email. For college placement cells and job platforms the
 * sender is an intermediary, so only the subject is used (`viaIntermediary`).
 */
export function guessCompany(subject: string, fromName: string, domain: string, viaIntermediary = false): string {
  const pats = [
    /\b(?:applying|application|applied|interest)\s+(?:to|at|with)\s+([A-Z][\w&.' -]{1,40}?)(?=\s*(?:[-–|:!,.(]|\bfor\b|$))/,
    /\b(?:interview|offer|assessment|test|opportunity|internship|role|position)\s+(?:with|at|from)\s+([A-Z][\w&.' -]{1,40}?)(?=\s*(?:[-–|:!,.(]|\bfor\b|$))/,
    /\b(?:at|with)\s+([A-Z][\w&.' -]{1,40}?)(?=\s*(?:[-–|:!,.(]|$))/,
  ];
  for (const p of pats) {
    const hit = p.exec(subject);
    if (hit) {
      const c = cleanCompany(hit[1]!);
      if (c) return c;
    }
  }
  const fromClean = viaIntermediary ? '' : cleanCompany(fromName);
  if (fromClean && !/linkedin|naukri|internshala|\bpod\b|\bcpc\b|placement|\bcell\b|university|college|ggsipu|\bipu\b|gmail|google/i.test(fromClean)) return fromClean;
  const seg = /^([A-Z][\w&.' ]{1,40}?)\s*[|:–—-]\s+\S/.exec(subject);
  if (seg) {
    const c = cleanCompany(seg[1]!);
    if (c && !/^(re|fwd|fw|reminder|update|important|urgent|invitation|action required)$/i.test(c)) return c;
  }
  if (viaIntermediary) return '';
  const parts = domain.split('.');
  const core = parts.length >= 2 ? parts[parts.length - 2]! : '';
  if (core && !PLATFORM_DOMAINS.test(core) && !/^(ac|co|gov|nic|edu)$/.test(core)) return core.charAt(0).toUpperCase() + core.slice(1);
  return '';
}

export function guessRole(subject: string, body: string): string {
  const text = subject + '\n' + body.slice(0, 1500);
  const m = /\b((?:[A-Z][\w/&+.-]*\s){0,5}(?:Intern(?:ship)?|Engineer|Developer|Analyst|Scientist|Trainee|Associate|Researcher|Fellow(?:ship)?))\b/.exec(text);
  if (!m) return '';
  return collapseWhitespace(m[1]!.replace(/^(for|the|a|an|our|your|of)\s+/i, '')).slice(0, 80);
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const KEYWORDS = /(deadline|last date|due|on or before|before|by|scheduled|interview (is )?on|test (is |will be )?on|date\s*[:-]|starts?|start time|complete|submit|valid (till|until)|expires?|closes?|register by|exam (on|date)|drive on|slot|confirmed for|booked for|appointment)/gi;

interface Found {
  index: number;
  y: number;
  mo: number;
  d: number;
  hasYear: boolean;
}

function findDates(text: string): Found[] {
  const out: Found[] = [];
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const patterns: [RegExp, (m: RegExpExecArray) => Omit<Found, 'index'> | null][] = [
    [/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/g, (m) => ({ y: +m[1]!, mo: +m[2]!, d: +m[3]!, hasYear: true })],
    [/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/g, (m) => ({ y: +m[3]!, mo: +m[2]!, d: +m[1]!, hasYear: true })],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${mon},?\\s*(20\\d\\d)?`, 'gi'), (m) => ({ y: m[3] ? +m[3] : 0, mo: MONTHS[m[2]!.toLowerCase()]!, d: +m[1]!, hasYear: Boolean(m[3]) })],
    [new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(20\\d\\d)?`, 'gi'), (m) => ({ y: m[3] ? +m[3] : 0, mo: MONTHS[m[1]!.toLowerCase()]!, d: +m[2]!, hasYear: Boolean(m[3]) })],
  ];
  for (const [re, conv] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const v = conv(m);
      if (v && v.mo >= 1 && v.mo <= 12 && v.d >= 1 && v.d <= 31) out.push({ index: m.index, ...v });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function findTime(text: string, from: number): string {
  const window = text.slice(from, from + 40);
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(window);
  if (ampm) {
    let h = +ampm[1]! % 12;
    if (/p/i.test(ampm[3]!)) h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2] ?? '00'}`;
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(window);
  return h24 ? `${h24[1]!.padStart(2, '0')}:${h24[2]}` : '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The most likely action date in an email: dates close after words like
 * "deadline", "by", "scheduled" win; a bare date only counts for categories
 * where dates are usually meaningful. Never returns a date before the email.
 */
export function extractDue(text: string, emailIso: string, category: MailCategory): { due: string; allDay: boolean } {
  const emailDate = new Date(emailIso);
  if (Number.isNaN(emailDate.getTime())) return { due: '', allDay: true };
  const flat = collapseWhitespace(text);
  const dates = findDates(flat);
  if (!dates.length) return { due: '', allDay: true };
  const keywordEnds: number[] = [];
  KEYWORDS.lastIndex = 0;
  let k: RegExpExecArray | null;
  while ((k = KEYWORDS.exec(flat))) keywordEnds.push(k.index + k[0].length);
  const min = emailDate.getTime() - 86_400_000;
  const max = emailDate.getTime() + 400 * 86_400_000;
  const resolve = (f: Found): Date | null => {
    let y = f.hasYear ? f.y : emailDate.getUTCFullYear();
    let dt = new Date(Date.UTC(y, f.mo - 1, f.d, 12));
    if (!f.hasYear && dt.getTime() < min) dt = new Date(Date.UTC(++y, f.mo - 1, f.d, 12));
    if (dt.getUTCMonth() !== f.mo - 1) return null;
    return dt.getTime() >= min && dt.getTime() <= max ? dt : null;
  };
  const near = dates.filter((f) => keywordEnds.some((e) => f.index >= e - 2 && f.index - e <= 60));
  const pool = near.length ? near : ['assessment', 'interview', 'deadline', 'exam', 'eligible', 'admissions'].includes(category) ? dates : [];
  for (const f of pool) {
    const dt = resolve(f);
    if (!dt) continue;
    const day = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    const time = findTime(flat, f.index);
    return time ? { due: `${day}T${time}`, allDay: false } : { due: day, allDay: true };
  }
  return { due: '', allDay: true };
}

// ---------------------------------------------------------------------------

export function classifyMail(m: RawMail, opts: { extraSenders?: string[] } = {}): Classification {
  const { name: fromName, address, domain } = parseFrom(m.from);
  // The snippet is a truncated copy of the body; only use it when there is no body.
  const content = m.body.trim() ? m.body : m.snippet;
  const text = `${m.subject}\n${content.slice(0, 6000)}`;
  const head = `${m.subject}\n${content.slice(0, 1500)}`;
  const placementSender = senderMatches(address, PLACEMENT_SENDERS);
  const extraSender = senderMatches(address, opts.extraSenders ?? []);
  const isApplicationConfirmation = /application was sent|your application (to|for|was|has)/i.test(m.subject);

  const noise = !extraSender && !isApplicationConfirmation && NOISE.some((re) => re.test(m.subject) || re.test(m.snippet));

  let category: MailCategory = 'other';
  for (const [cat, re] of RULES) {
    if (re.test(head)) {
      category = cat;
      break;
    }
  }
  if (EXAM_DOMAINS.test(domain) && !['offer', 'rejected'].includes(category)) category = 'exam';
  if (category === 'other' && placementSender) category = 'eligible';

  const studySignal = UNIVERSITY_DOMAIN.test(domain) || /admission|erasmus|scholarship|master'?s|phd|graduate program|mbzuai|kaust|uni-assist|daad|ielts|toefl/i.test(m.subject);
  const jobSignal =
    placementSender ||
    ATS_DOMAINS.test(domain) ||
    /career|recruit|talent|hiring|\bjobs?\b|\bhr\b/i.test(fromName) ||
    /intern|internship|placement|\bjob\b|\brole\b|position|hiring|recruit/i.test(head);
  const pipelineCategory = ['eligible', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'on-hold'].includes(category);
  let area: Area;
  if (category === 'exam' || EXAM_DOMAINS.test(domain)) area = 'exams';
  else if (category === 'admissions' || (studySignal && !placementSender && !ATS_DOMAINS.test(domain))) area = 'studies';
  else if (pipelineCategory || (jobSignal && category === 'deadline')) area = 'internships';
  else area = 'general';

  const intermediary = placementSender || /linkedin|naukri|internshala|unstop|superset/i.test(domain);
  const company = area === 'internships' ? guessCompany(m.subject, fromName, domain, intermediary) : '';
  const role = area === 'internships' ? guessRole(m.subject, m.body) : '';
  const { due, allDay } = extractDue(text, m.date, category);
  const suggestedStage = area === 'internships' ? STAGE_FOR[category] ?? '' : '';
  const who = company || (area === 'studies' ? fromName || 'University' : '');
  const subj = truncate(collapseWhitespace(m.subject), 90);
  const taskTitle =
    category === 'assessment'
      ? `Complete ${who ? who + ' ' : ''}assessment`
      : category === 'interview'
        ? `Interview${who ? ': ' + who : ''}${role ? ' (' + role + ')' : ''}`
        : category === 'eligible'
          ? `Register: ${who || subj}${role && who ? ' (' + role + ')' : ''}`
          : category === 'offer'
            ? `Respond to ${who || 'the'} offer`
            : ['exam', 'admissions', 'deadline'].includes(category)
              ? subj
              : '';
  const important = !noise && category !== 'other';
  return { category, area, noise, important, company, role, due, allDay, suggestedStage, taskTitle, fromName: fromName || address, fromAddress: address };
}

/** Gmail queries: placement keywords and senders (from the routine) plus admissions, exams and deadlines. */
export function mailQueries(days: number, extraSenders: string[] = []): string[] {
  const w = `newer_than:${days}d`;
  const q = [
    `${w} (interview OR shortlisted OR "next round" OR assessment OR "online test" OR "coding test" OR "offer letter" OR "regret to inform" OR "not moving forward" OR "cannot proceed" OR "application received" OR "your application" OR "application was sent" OR "thank you for applying")`,
    `${w} from:(${PLACEMENT_SENDERS.join(' OR ')})`,
    `${w} (admission OR "application portal" OR uni-assist OR erasmus OR scholarship OR DAAD OR "recommendation letter" OR referee OR MBZUAI OR KAUST OR IELTS OR TOEFL)`,
    `${w} (from:upsc.gov.in OR from:ssc.gov.in OR from:ssc.nic.in OR from:nta.ac.in OR from:ibps.in OR "admit card" OR "hall ticket")`,
    `${w} (deadline OR "last date" OR "due date" OR "submit by") -category:promotions -category:social`,
  ];
  if (extraSenders.length) q.push(`${w} from:(${extraSenders.join(' OR ')})`);
  return q;
}

/** Normalised company key for matching an email to a tracked application. */
export function companyKey(s: string): string {
  return normalizeKey(s).replace(/\b(inc|llc|ltd|limited|pvt|private|technologies|technology|labs?|corp|corporation|india|global|solutions|software|the)\b/g, '').replace(/\s+/g, ' ').trim();
}
