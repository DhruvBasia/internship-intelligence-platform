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
  /** Subject without "Re:" / "Fwd:" prefixes. */
  cleanSubject: string;
}

/** College placement cell / POD senders (GGSIPU) and job platforms. */
export const PLACEMENT_SENDERS = ['cpc@ipu.ac.in', 'placements.edc@ipu.ac.in', 'notifications@pod.ai', 'kodnest.com', 'internshala.com', 'naukri.com', 'monsterindia.com', 'jobs-noreply@linkedin.com'];
const ATS_DOMAINS = /(greenhouse\.io|greenhouse-mail\.io|lever\.co|ashbyhq\.com|myworkday(jobs)?\.com|workday\.com|smartrecruiters\.com|icims\.com|successfactors|taleo\.net|oraclecloud\.com|hackerrank\.com|hackerearth\.com|codility\.com|mettl\.com|codesignal\.com|unstop\.com|superset\.com|pod\.ai)$/i;
const EXAM_DOMAINS = /(upsc\.gov\.in|ssc\.gov\.in|ssc\.nic\.in|nta\.ac\.in|nta\.nic\.in|ibps\.in|rbi\.org\.in|dsssb|joinindianarmy|joinindiannavy|careerairforce|gate\.iit|isro\.gov\.in|sebi\.gov\.in)/i;
const UNIVERSITY_DOMAIN = /(\.edu|\.ac\.(uk|ae|jp|kr|nz|za|at|be)|\.edu\.[a-z]{2}|uni-[a-z]+\.de|tu-[a-z]+\.de|\.uni\.[a-z]+|mbzuai\.ac\.ae|kaust\.edu\.sa|uni-assist\.de|daad\.de|erasmus|\.ac\.ae)$/i;
const PLATFORM_DOMAINS = /^(gmail|googlemail|outlook|hotmail|yahoo|icloud|linkedin|naukri|internshala|pod|ipu|greenhouse|greenhouse-mail|lever|ashbyhq|myworkday|myworkdayjobs|workday|smartrecruiters|icims|hackerrank|hackerearth|codility|mettl|codesignal|unstop|superset|google|microsoft|seek|indeed|foundit|instahyre|wellfound|cutshort|apna|glassdoor|commudle)$/i;
/** Job boards and portals that send mail on behalf of the actual employer. */
const INTERMEDIARY_DOMAINS = /linkedin|naukri|internshala|unstop|superset|seek\.com|indeed|foundit|instahyre|wellfound|cutshort|apna\.co|glassdoor/i;

/** Matched against the subject only: job-alert digests ("… at Acme and more"). */
const SUBJECT_NOISE: RegExp[] = [
  /hiring now|new opportunities at|\band (?:\d+\+? )?(?:others|more)\s*$|jobs? (?:picked )?for you\b/i,
  /\botp\b|one[- ]time password|verification code|security code|login code|access code|sign[- ]in code/i,
  /^welcome to (?:seek|internshala|naukri|linkedin|unstop|indeed|wellfound|glassdoor|foundit|instahyre|apna|cutshort|superset)\b/i,
];

/** Hackathons, contests and event promotions: worth reading, not job applications. */
const EVENT = /hackathon|buildathon|ideathon|codevita|code ?vita|\bcontest\b|see what'?s new|what'?s new in|bootcamp|\bsummit\b|\bmeetup\b/i;

/** "Finish your application" reminders mean the application was NOT submitted. */
const INCOMPLETE = /finish your application|complete your application|continue your application|don'?t forget to (?:submit|apply|complete)|still accepting applications|application (?:is )?(?:incomplete|pending completion)/i;

/** Interviews and assessments only count as job pipeline when the email is about a job. */
const JOB_CONTEXT = /intern|internship|placement|\bjobs?\b|\brole\b|position|hiring|recruit|applica|candidate|shortlist|\bdrive\b|campus|\boffer\b|career|talent|\bhr\b/i;

const NOISE: RegExp[] = [
  /\botp\b|one[- ]time password|verification code|security code|login code|access code|sign[- ]in code|verify your (email|account)|password reset|confirm your email/i,
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
  ['applied', /application (has been )?(received|submitted|complete)|thank(s| you) for (applying|your application|your interest in)|your application (to|for|was|has)|application was sent|received your (?:[\w&.-]+ ){0,3}application/i],
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

const COMPANY_STOP = /\b(careers?|recruiting|recruitment|recruiter|talent( acquisition)?|hiring( team)?|team|jobs|hr|people|university relations|campus|no-?reply|notifications?|welcome|reminders?|updates?|alerts?|via [\w .]+)\b/gi;
/** Words that trail a company name in confirmation subjects ("… at Acme successfully submitted"). */
const TRAILING_JUNK = /\s+(?:successfully\s+submitted|has\s+been\s+\w+|is\s+(?:received|submitted|confirmed)|was\s+\w+|submitted|received|and\s+(?:\d+\+?\s+)?(?:others|more))\s*$/i;
const DOMAIN_SUFFIX = /\.(?:in|com|io|ai|co|store|tech|app|org|net|dev)$/i;
const GENERIC_COMPANY = /^(application status update|application update|status update|registration confirmed|registration|next steps?|reminder|update|important|congratulations|thank you|security code|your application|application|internship|job|career|careers|tag)$/i;

function cleanCompany(s: string): string {
  let c = collapseWhitespace(s.replace(COMPANY_STOP, ' ').replace(/[|·•:–—-]+$/g, '').replace(/^[|·•:–—-]+/g, ''));
  c = collapseWhitespace(c.replace(TRAILING_JUNK, '').replace(DOMAIN_SUFFIX, ''));
  if (c.length < 2 || c.length > 50 || /^(the|your|our|a|an|you|we)$/i.test(c) || GENERIC_COMPANY.test(c)) return '';
  return c;
}

/** A display name that is really an address ("donotreply.indiacampus", "no-reply@…"); "Alphashots.ai" is a real name. */
function addressLike(name: string): boolean {
  const n = name.trim();
  return !n || n.includes('@') || /^(do-?not-?reply|no-?reply|noreply|mailer|notifications?)\b/i.test(n);
}

const NAME = `[A-Z][\\w&.'-]*(?:\\s+(?:[A-Z][\\w&.'-]*|&|of|and))*?`;

/**
 * Company behind an email. For college placement cells and job platforms the
 * sender is an intermediary, so only the subject is used (`viaIntermediary`).
 */
export function guessCompany(subject: string, fromName: string, domain: string, viaIntermediary = false): string {
  const end = String.raw`(?=\s*(?:[-–|:!,.(]|\bfor\b|\s(?:successfully|has been|is|was)\b|$))`;
  const pats = [
    // "We received your Stripe Application"
    new RegExp(String.raw`\b[Yy]our\s+(${NAME})\s+[Aa]pplication\b`),
    // "Accenture Recruitment Process: …", "Infosys Hiring Drive"
    new RegExp(String.raw`^(${NAME})\s+(?:[Rr]ecruitment|[Hh]iring|[Cc]ampus|[Pp]lacement|[Oo]ff[- ][Cc]ampus)\s+(?:[Pp]rocess|[Dd]rive|[Pp]rogram(?:me)?)\b`),
    // "Registration Confirmed - Cloud Analogy Drive on Monday"
    new RegExp(String.raw`[-–|:]\s*(${NAME})\s+(?:[Dd]rive|[Hh]iring|[Rr]ecruitment)\b`),
    // "Application Status Update – Cloud Analogy"
    /\b(?:[Ss]tatus [Uu]pdate|[Uu]pdate)\s*[-–|:]\s*([A-Z][\w&.' -]{1,40}?)\s*$/,
    // "Elnakeeb Pty Ltd. is still accepting applications"
    /^([A-Z][\w&.' -]{1,40}?)\s+is still accepting applications/,
    new RegExp(String.raw`\b(?:applying|application|applied|interest)\s+(?:to|at|with)\s+([A-Z][\w&.' -]{1,40}?)${end}`),
    new RegExp(String.raw`\b(?:interview|offer|assessment|test|opportunity|internship|role|position)\s+(?:with|at|from)\s+([A-Z][\w&.' -]{1,40}?)${end}`),
    /\b(?:at|with)\s+([A-Z][\w&.' -]{1,40}?)(?=\s*(?:[-–|:!,.(]|$))/,
  ];
  for (const p of pats) {
    const hit = p.exec(subject);
    if (hit) {
      const c = cleanCompany(hit[1]!);
      if (c) return c;
    }
  }
  const fromClean = viaIntermediary || addressLike(fromName) ? '' : cleanCompany(fromName);
  if (fromClean && !/linkedin|naukri|internshala|\bpod\b|\bcpc\b|placement|\bcell\b|university|college|ggsipu|\bipu\b|gmail|google|seek|indeed|unstop/i.test(fromClean)) return fromClean;
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

/** InternIQ's own daily digest (earlier versions emailed it from the student's account as "InternIQ"). */
export function isInternIqDigest(fromName: string, subject: string): boolean {
  if (/^internIQ$/i.test(fromName.trim())) return true;
  return /^\d+ new internship match(es)? \(\d+\+\)|^\d+ things? due in the next \d+ days?$/i.test(subject.trim());
}

/** Hackathon / contest / promo email (by subject or sender name). */
export function isEventMail(subject: string, fromName: string): boolean {
  return EVENT.test(subject) || EVENT.test(fromName);
}

/** Whether the text is about a job at all (used to reject marketing "interviews"). */
export function hasJobContext(text: string): boolean {
  return JOB_CONTEXT.test(text);
}

/** The employer behind an email, whatever its category (used to tidy up existing records). */
export function mailCompany(subject: string, from: string, opts: { selfEmail?: string } = {}): string {
  const { name, address, domain } = parseFrom(from);
  const self = Boolean(opts.selfEmail) && address === opts.selfEmail!.trim().toLowerCase();
  const intermediary = self || senderMatches(address, PLACEMENT_SENDERS) || INTERMEDIARY_DOMAINS.test(domain);
  return guessCompany(stripReplyPrefixes(subject), self ? '' : name, self ? '' : domain, intermediary);
}

/** "Re: Fwd: Subject" → "Subject". */
export function stripReplyPrefixes(subject: string): string {
  return subject.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').trim();
}

export function classifyMail(m: RawMail, opts: { extraSenders?: string[]; selfEmail?: string } = {}): Classification {
  const parsed = parseFrom(m.from);
  const { address } = parsed;
  // Something the student forwarded to themselves: the sender says nothing about the company.
  const self = Boolean(opts.selfEmail) && address === opts.selfEmail!.trim().toLowerCase();
  const fromName = parsed.name;
  const domain = self ? '' : parsed.domain;
  const subject = stripReplyPrefixes(m.subject);
  // The snippet is a truncated copy of the body; only use it when there is no body.
  const content = m.body.trim() ? m.body : m.snippet;
  const text = `${subject}\n${content.slice(0, 6000)}`;
  const head = `${subject}\n${content.slice(0, 1500)}`;
  const placementSender = senderMatches(address, PLACEMENT_SENDERS);
  const extraSender = senderMatches(address, opts.extraSenders ?? []);
  const isApplicationConfirmation = /application was sent|your application (to|for|was|has)/i.test(subject) && !INCOMPLETE.test(subject);

  const noise =
    isInternIqDigest(fromName, subject) ||
    SUBJECT_NOISE.some((re) => re.test(subject)) ||
    (!extraSender && !isApplicationConfirmation && NOISE.some((re) => re.test(subject) || re.test(m.snippet)));

  let category: MailCategory = 'other';
  if (INCOMPLETE.test(subject)) category = 'eligible';
  else {
    for (const [cat, re] of RULES) {
      if (re.test(head)) {
        category = cat;
        break;
      }
    }
  }
  if (EXAM_DOMAINS.test(domain) && !['offer', 'rejected'].includes(category)) category = 'exam';
  // A company's own test ("Accenture Recruitment Process: Download your Admit Card") is not a government exam.
  if (category === 'exam' && !EXAM_DOMAINS.test(domain) && /recruit|hiring|placement|campus|\bdrive\b/i.test(subject)) category = 'assessment';
  if (category === 'other' && placementSender) category = 'eligible';
  const isEvent = EVENT.test(subject) || EVENT.test(fromName);
  if (isEvent && !['offer', 'rejected', 'exam', 'admissions'].includes(category)) category = 'other';
  const jobContext = placementSender || ATS_DOMAINS.test(domain) || JOB_CONTEXT.test(`${head}\n${fromName}\n${address}`);
  if ((category === 'interview' || category === 'assessment') && !jobContext) category = 'other';

  const studySignal = UNIVERSITY_DOMAIN.test(domain) || /admission|erasmus|scholarship|master'?s|phd|graduate program|mbzuai|kaust|uni-assist|daad|ielts|toefl/i.test(subject);
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

  const intermediary = self || placementSender || INTERMEDIARY_DOMAINS.test(domain);
  const company = area === 'internships' ? guessCompany(subject, self ? '' : fromName, domain, intermediary) : '';
  const role = area === 'internships' ? guessRole(subject, m.body) : '';
  const { due, allDay } = extractDue(text, m.date, category);
  const suggestedStage = area === 'internships' ? STAGE_FOR[category] ?? '' : '';
  const who = company || (area === 'studies' ? fromName || 'University' : '');
  const subj = truncate(collapseWhitespace(subject), 90);
  const taskTitle = INCOMPLETE.test(subject)
    ? `Finish application: ${role || 'role'}${company ? ' at ' + company : ''}`
    : category === 'assessment'
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
  return { category, area, noise, important, company, role, due, allDay, suggestedStage, taskTitle, fromName: fromName || address, fromAddress: address, cleanSubject: subject };
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
