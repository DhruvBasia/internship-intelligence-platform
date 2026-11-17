/**
 * The free, offline matcher. It scores every job with no API key and no quota,
 * using the same four dimensions and output shape as the AI analysis so the UI
 * can treat both the same way. It also decides which jobs are relevant enough
 * to ingest at all.
 */
import type { MatchResult, Profile, ScoreBreakdown, Settings, Verdict, WorkMode } from './types';
import { extractSkills, canonicalSkill } from './skills';
import { clamp, fnv1a, normalizeKey, phraseRegExp, uniq } from './text';

export interface JobText {
  company: string;
  role: string;
  location: string;
  workMode: WorkMode;
  description: string;
  requirements: string;
  tags: string[];
}

export const WEIGHTS: ScoreBreakdown = { skills: 0.4, role: 0.25, level: 0.2, location: 0.15 };

const INTERN_RE =
  /\b(interns?|internships?|co-?ops?|trainee|apprentice(ship)?|werkstudent|working student|student researcher|fellowship|summer (analyst|associate|student|scholar|researcher|research)|industrial placement|placement year|year in industry|vacation (scholar|scholarship|student)|undergraduate research|research (intern|assistant))\b/i;
const POSTDOC_RE = /\bpost-?doc(toral)?\b/i;
const SENIOR_RE = /\b(senior|sr\.|staff|principal|lead|manager|director|head of|vp|vice president|architect)\b/i;
const NO_SPONSOR_RE =
  /(u\.?s\.? citizenship (is )?required|must be (a )?(u\.?s\.? )?citizen|security clearance|(not|unable to) (provide|offer|sponsor)\s+(visa |work )?sponsorship|no (visa )?sponsorship|without (the )?need (for|of) (visa )?sponsorship|does not offer sponsorship|citizenship is required)/i;
const PHD_ONLY_RE = /(ph\.?d\.?|doctoral) (students?|candidates?)\s+(only|required)|(currently )?(pursuing|enrolled in) (a )?(ph\.?d|doctorate)\b|\bph\.?d\.? (intern|internship|residency)\b/i;
const MASTERS_ONLY_RE = /(master'?s|graduate) (students?|candidates?) only|(currently )?(pursuing|enrolled in) (a )?master'?s\b/i;
const YEARS_EXP_RE = /(\d{1,2})\+?\s*(?:years|yrs)\b[^.\n]{0,40}?\bexperience/i;
const GRAD_RE = /graduat\w*[^.\n]{0,80}?\b(20\d\d)\b(?:[^.\n]{0,40}?\b(20\d\d)\b)?/i;

/** Role abbreviations people type in their targets, expanded to what postings say. */
const ROLE_SYNONYMS: Record<string, string[]> = {
  ml: ['machine learning', 'ML'],
  ai: ['artificial intelligence', 'AI'],
  swe: ['software engineer', 'software engineering', 'software developer', 'SWE'],
  sde: ['software development engineer', 'software engineer', 'SDE'],
  ds: ['data science', 'data scientist'],
  nlp: ['natural language processing', 'NLP'],
  cv: ['computer vision'],
  pm: ['product manager', 'product management'],
  ux: ['ux design', 'user experience', 'UX'],
  sre: ['site reliability', 'SRE'],
  devops: ['devops', 'platform engineer', 'infrastructure engineer'],
  quant: ['quantitative', 'quant'],
  'data science': ['data science', 'data scientist'],
  'data scientist': ['data science', 'data scientist'],
  'software engineering': ['software engineer', 'software engineering', 'software developer'],
  'software engineer': ['software engineer', 'software engineering', 'software developer'],
  'machine learning': ['machine learning', 'ML'],
};

function termPatterns(term: string): RegExp[] {
  const key = term.trim().toLowerCase();
  const variants = ROLE_SYNONYMS[key] ?? [term];
  return uniq(variants).map((v) => (v.length <= 3 && v === v.toUpperCase() ? phraseRegExp(v, '') : phraseRegExp(v)));
}

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

export function isInternship(role: string, tags: string[] = []): boolean {
  if (tags.includes('internship')) return true;
  return INTERN_RE.test(role) && !POSTDOC_RE.test(role);
}

/**
 * Work mode from the location field first. Free text only counts with explicit
 * phrases, so "remote sensing" or "distributed systems" never read as remote.
 */
export function detectWorkMode(location: string, extra = ''): WorkMode {
  const loc = location.toLowerCase();
  if (/\bhybrid\b/.test(loc)) return 'hybrid';
  if (/\b(remote|anywhere|work from home|wfh)\b/.test(loc)) return 'remote';
  if (/\bon-?site\b|\bin[- ]office\b/.test(loc)) return 'onsite';
  const x = extra.slice(0, 1200).toLowerCase();
  if (/\bhybrid (role|position|work|schedule|model|internship)\b/.test(x)) return 'hybrid';
  if (/\b(fully remote|100% remote|remote[- ]first|remote (role|position|internship|opportunity)|work from home)\b/.test(x)) return 'remote';
  if (location.trim() && !/^(tbd|n\/?a|unknown|various|multiple)$/i.test(location.trim())) return 'onsite';
  return 'unknown';
}

/** Hash of every profile field that influences scoring; used to detect stale matches. */
export function profileHash(profile: Profile): string {
  return fnv1a(
    JSON.stringify([
      profile.skills.map((s) => s.toLowerCase()).sort(),
      profile.targetRoles.map((s) => s.toLowerCase()).sort(),
      profile.degree,
      profile.gradYear,
      profile.locations.map((s) => s.toLowerCase()).sort(),
      [...profile.workModes].sort(),
      profile.needsSponsorship,
      fnv1a(profile.resumeText),
    ]),
  );
}

export function profileSkills(profile: Profile): string[] {
  return uniq([...profile.skills.map(canonicalSkill), ...extractSkills(profile.resumeText)]);
}

export function verdictFor(score: number): Verdict {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 50) return 'stretch';
  return 'weak';
}

export function weightedScore(b: ScoreBreakdown): number {
  return Math.round(b.skills * WEIGHTS.skills + b.role * WEIGHTS.role + b.level * WEIGHTS.level + b.location * WEIGHTS.location);
}

const DEGREE_LABEL: Record<string, string> = { bachelors: "Bachelor's", masters: "Master's", phd: 'PhD' };

/** Deterministic match. Never throws; empty profiles produce neutral scores with guidance. */
export function scoreLocally(job: JobText, profile: Profile, now: Date = new Date()): MatchResult {
  const text = [job.role, job.description, job.requirements].join('\n');
  const strengths: string[] = [];
  const gaps: string[] = [];
  const tips: string[] = [];
  const flags: string[] = [];
  let hardCap = 100;

  // Skills
  const mine = profileSkills(profile);
  const mineLower = new Set(mine.map((s) => s.toLowerCase()));
  const jobSkills = extractSkills(text);
  // User skills the dictionary does not know about still count when the posting names them.
  for (const raw of profile.skills) {
    if (jobSkills.some((s) => s.toLowerCase() === raw.toLowerCase())) continue;
    if (raw.length >= 2 && phraseRegExp(raw).test(text)) jobSkills.push(raw);
  }
  const matchedSkills = jobSkills.filter((s) => mineLower.has(s.toLowerCase()));
  const missingSkills = jobSkills.filter((s) => !mineLower.has(s.toLowerCase()));
  let skills: number;
  if (!mine.length) {
    skills = 50;
    gaps.push('Add your skills or resume in your profile to get a real skills score.');
  } else if (!jobSkills.length) {
    skills = 55;
  } else {
    const coverage = matchedSkills.length / jobSkills.length;
    skills = 30 + 70 * coverage + (matchedSkills.length >= 4 ? 5 : 0);
    if (matchedSkills.length) strengths.push('Skills you have: ' + matchedSkills.slice(0, 6).join(', '));
    if (missingSkills.length) gaps.push('Not in your profile: ' + missingSkills.slice(0, 6).join(', '));
  }

  // Role alignment
  let role: number;
  const targets = profile.targetRoles;
  if (!targets.length) {
    role = 60;
  } else {
    const tagText = job.tags.join(' ');
    let best = 30;
    let hit = '';
    for (const t of targets) {
      const pats = termPatterns(t);
      let s = 30;
      if (anyMatch(pats, job.role)) s = 92;
      else if (anyMatch(pats, tagText)) s = 72;
      else if (anyMatch(pats, job.description.slice(0, 3000) + ' ' + job.requirements.slice(0, 2000))) s = 62;
      if (s > best) {
        best = s;
        hit = t;
      }
    }
    role = best;
    if (best >= 72) strengths.push(`Lines up with your target role "${hit}"`);
    else if (best >= 62) strengths.push(`Mentions your interest "${hit}" in the description`);
    else gaps.push("Title doesn't match any of your target roles");
  }

  // Level / eligibility
  let level = 72;
  if (SENIOR_RE.test(job.role) && !isInternship(job.role, job.tags)) {
    level = 15;
    flags.push('Senior-level title');
    hardCap = Math.min(hardCap, 40);
  }
  const yrs = YEARS_EXP_RE.exec(text);
  if (yrs) {
    const n = Number(yrs[1]);
    if (n >= 3) {
      level = Math.min(level, 30);
      flags.push(`Asks for ${n}+ years of experience`);
    } else if (n >= 1) {
      level = Math.min(level, 60);
    }
  }
  const degreeTags = job.tags.filter((t) => /^(bachelor|master|phd|associate)/i.test(t));
  const myDegree = profile.degree;
  if (myDegree && DEGREE_LABEL[myDegree]) {
    const label = DEGREE_LABEL[myDegree]!;
    if (degreeTags.length && !degreeTags.some((t) => t.toLowerCase().startsWith(label.toLowerCase().slice(0, 5)))) {
      level = Math.min(level, 30);
      flags.push('Listed for ' + degreeTags.join(' / ') + ' students');
      hardCap = Math.min(hardCap, 50);
    } else if (degreeTags.length) {
      level = Math.max(level, 80);
    }
    if (myDegree !== 'phd' && PHD_ONLY_RE.test(text)) {
      level = Math.min(level, 25);
      flags.push('Appears to be for PhD students');
      hardCap = Math.min(hardCap, 45);
    } else if (myDegree === 'bachelors' && MASTERS_ONLY_RE.test(text)) {
      level = Math.min(level, 35);
      flags.push("Appears to be for Master's students");
    }
  }
  const grad = GRAD_RE.exec(text);
  if (grad && profile.gradYear) {
    const ys = [Number(grad[1]), grad[2] ? Number(grad[2]) : Number(grad[1])];
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    if (hi >= now.getFullYear() - 1 && hi <= now.getFullYear() + 8) {
      if (profile.gradYear >= lo && profile.gradYear <= hi) {
        level = Math.max(level, 90);
        strengths.push(`Your ${profile.gradYear} graduation fits their window`);
      } else {
        level = Math.min(level, 35);
        flags.push(`Graduation window ${lo === hi ? lo : lo + '–' + hi} vs your ${profile.gradYear}`);
      }
    }
  }

  // Location / authorisation
  let location = 70;
  const prefs = profile.locations.map(normalizeKey).filter(Boolean);
  const modes = profile.workModes;
  if (prefs.length || modes.length) {
    const loc = normalizeKey(job.location);
    const locHit = prefs.some((p) => loc.includes(p) || p.split(' ').some((w) => w.length > 3 && loc.includes(w)));
    if (job.workMode === 'remote' && modes.includes('remote')) {
      location = 95;
      strengths.push('Remote, which you prefer');
    } else if (locHit) {
      location = 90;
      strengths.push('In one of your preferred locations');
    } else if (job.workMode === 'remote') {
      location = 75;
    } else if (job.workMode === 'hybrid' && modes.includes('hybrid')) {
      location = 70;
    } else if (job.workMode === 'unknown') {
      location = 60;
    } else {
      location = 40;
      gaps.push('Outside your preferred locations');
    }
  }
  if (profile.needsSponsorship) {
    const sponsorTag = job.tags.find((t) => /citizenship is required|does not offer sponsorship/i.test(t));
    if (sponsorTag || NO_SPONSOR_RE.test(text)) {
      location = Math.min(location, 15);
      flags.push(sponsorTag ? sponsorTag : 'May not sponsor visas or may require citizenship');
      hardCap = Math.min(hardCap, 40);
    }
  }

  const breakdown: ScoreBreakdown = {
    skills: Math.round(clamp(skills, 0, 100)),
    role: Math.round(clamp(role, 0, 100)),
    level: Math.round(clamp(level, 0, 100)),
    location: Math.round(clamp(location, 0, 100)),
  };
  const score = Math.min(hardCap, weightedScore(breakdown));
  const verdict = verdictFor(score);

  if (matchedSkills.length) tips.push(`Open with your strongest ${matchedSkills[0]} project; it is what this posting asks for.`);
  if (missingSkills.length) tips.push(`If you have used ${missingSkills[0]}, add it to your profile so it counts.`);
  if (!tips.length) tips.push('Run the AI analysis for tailored advice on this posting.');

  const skillPart = jobSkills.length ? `${matchedSkills.length} of ${jobSkills.length} listed skills match` : 'no specific skills listed';
  const summary = `${verdictWord(verdict)} fit: ${skillPart}${flags.length ? '; check: ' + flags[0].toLowerCase() : ''}.`;

  return {
    score,
    breakdown,
    verdict,
    summary,
    strengths: strengths.slice(0, 5),
    gaps: gaps.slice(0, 5),
    tips: tips.slice(0, 3),
    flags: uniq(flags).slice(0, 5),
    matchedSkills: matchedSkills.slice(0, 20),
    missingSkills: missingSkills.slice(0, 20),
    method: 'local',
    model: 'keyword-v2',
    scoredAt: now.toISOString(),
    profileHash: profileHash(profile),
  };
}

export function verdictWord(v: Verdict): string {
  return v === 'strong' ? 'Strong' : v === 'good' ? 'Good' : v === 'stretch' ? 'Stretch' : 'Weak';
}

/** Ingestion filter: is this posting worth adding to the user's board at all? */
export function isRelevant(job: JobText, profile: Profile, filters: Settings['filters']): boolean {
  if (filters.internshipsOnly && !isInternship(job.role, job.tags)) return false;
  for (const ex of filters.excludeKeywords) {
    if (ex && phraseRegExp(ex).test(job.role)) return false;
  }
  const terms = [...profile.targetRoles, ...filters.includeKeywords];
  if (!terms.length) return true;
  const hay = job.role + '\n' + job.tags.join(' ') + '\n' + job.description.slice(0, 800);
  return terms.some((t) => anyMatch(termPatterns(t), hay));
}
