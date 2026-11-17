import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, mergeSettings, normalizeProfile } from '../src/shared/defaults';
import { detectWorkMode, isInternship, isRelevant, profileHash, scoreLocally } from '../src/shared/match';
import { canonicalSkill, extractSkills } from '../src/shared/skills';
import { canonicalUrl, escapeHtml, htmlToText, roleKey, safeHttpUrl, splitList, toIsoDate } from '../src/shared/text';
import type { Profile } from '../src/shared/types';

const profile = (p: Partial<Profile> = {}): Profile => normalizeProfile({ ...DEFAULT_PROFILE, ...p });

describe('text helpers', () => {
  it('only allows http(s) links', () => {
    expect(safeHttpUrl('https://jobs.lever.co/x/1')).toBe('https://jobs.lever.co/x/1');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('data:text/html,hi')).toBe('');
    expect(safeHttpUrl('https://evil.com/"><script>')).toBe('');
    expect(safeHttpUrl('  HTTP://Example.com/a ')).toBe('HTTP://Example.com/a');
  });

  it('canonicalises URLs for de-duplication', () => {
    expect(canonicalUrl('https://www.Example.com/jobs/1/?utm_source=Simplify&ref=Simplify#apply')).toBe('example.com/jobs/1');
    expect(canonicalUrl('https://boards.greenhouse.io/acme/jobs/9?gh_src=abc&gh_jid=9')).toBe('boards.greenhouse.io/acme/jobs/9?gh_jid=9');
    expect(canonicalUrl('not a url')).toBe('');
  });

  it('collapses reposted roles to the same key', () => {
    expect(roleKey('Acme, Inc.', 'Machine Learning Intern - Summer 2027')).toBe(roleKey('ACME', 'Machine Learning Internship (Summer 2026)'));
    expect(roleKey('Acme', 'Data Science Intern')).not.toBe(roleKey('Acme', 'Machine Learning Intern'));
  });

  it('turns (double-escaped) HTML into readable text', () => {
    const t = htmlToText('&lt;p&gt;Hello&amp;nbsp;world&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;');
    expect(t).toContain('Hello world');
    expect(t).toContain('• Python');
    expect(t).not.toContain('<');
    expect(htmlToText('<script>evil()</script><p>ok</p>')).toBe('ok');
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;');
  });

  it('parses unix seconds, ms and ISO dates', () => {
    expect(toIsoDate(1794844377)).toBe(new Date(1794844377 * 1000).toISOString());
    expect(toIsoDate(1794844377000)).toBe(new Date(1794844377000).toISOString());
    expect(toIsoDate('2026-11-16')).toBe('2026-11-16T00:00:00.000Z');
    expect(toIsoDate('soon')).toBe('');
  });

  it('splits lists without duplicates', () => {
    expect(splitList('Python, python; SQL\nPyTorch|  ')).toEqual(['Python', 'SQL', 'PyTorch']);
  });
});

describe('skills', () => {
  it('extracts skills with word boundaries and symbols', () => {
    const s = extractSkills('Experience with C++, PyTorch and SQL. Familiar with Node.js and Go. Send your CV and excel at teamwork.');
    expect(s).toEqual(expect.arrayContaining(['C++', 'PyTorch', 'SQL', 'Node.js', 'Go']));
    expect(s).not.toContain('Computer Vision');
    expect(s).not.toContain('Excel');
  });

  it('does not confuse internal/international or R&D', () => {
    expect(extractSkills('Our R&D team in an international company')).not.toContain('R');
  });

  it('maps aliases to canonical names', () => {
    expect(canonicalSkill('sklearn')).toBe('scikit-learn');
    expect(canonicalSkill('golang')).toBe('Go');
    expect(canonicalSkill('Underwater basket weaving')).toBe('Underwater basket weaving');
  });
});

describe('internship detection', () => {
  it('recognises internships but not "international" or "internal"', () => {
    expect(isInternship('Machine Learning Intern (Summer 2027)')).toBe(true);
    expect(isInternship('Software Engineering Co-op')).toBe(true);
    expect(isInternship('Student Researcher, BS/MS')).toBe(true);
    expect(isInternship('Director, US International Tax Planning')).toBe(false);
    expect(isInternship('Internal Communications Manager')).toBe(false);
    expect(isInternship('Postdoctoral Research Fellowship')).toBe(false);
    expect(isInternship('Software Engineer', ['internship'])).toBe(true);
  });

  it('detects work mode', () => {
    expect(detectWorkMode('Remote - US')).toBe('remote');
    expect(detectWorkMode('London · Hybrid')).toBe('hybrid');
    expect(detectWorkMode('Bengaluru, India')).toBe('onsite');
    expect(detectWorkMode('')).toBe('unknown');
    expect(detectWorkMode('India (Onsite)', 'Field focus: ML / remote sensing; distributed systems')).toBe('onsite');
    expect(detectWorkMode('', 'This is a fully remote internship.')).toBe('remote');
  });
});

describe('free matcher', () => {
  const me = profile({
    degree: 'bachelors',
    gradYear: 2027,
    skills: ['Python', 'PyTorch', 'SQL'],
    targetRoles: ['Machine Learning'],
    locations: ['Bengaluru'],
    workModes: ['remote'],
  });
  const base = { company: 'Acme', location: 'Bengaluru, India', workMode: 'onsite' as const, requirements: '', tags: [] };

  it('scores a strong fit highly and explains why', () => {
    const m = scoreLocally({ ...base, role: 'Machine Learning Intern', description: 'You will use Python, PyTorch and SQL. Graduating between Dec 2026 and Jun 2027.' }, me);
    expect(m.score).toBeGreaterThanOrEqual(80);
    expect(m.verdict).toBe('strong');
    expect(m.matchedSkills).toEqual(expect.arrayContaining(['Python', 'PyTorch', 'SQL']));
    expect(m.strengths.join(' ')).toMatch(/target role/);
    expect(m.method).toBe('local');
  });

  it('penalises senior roles and missing skills', () => {
    const m = scoreLocally({ ...base, role: 'Senior Staff Engineer', description: 'Kubernetes, Go and Terraform. 7+ years of experience.' }, me);
    expect(m.score).toBeLessThanOrEqual(40);
    expect(m.flags.join(' ')).toMatch(/Senior|years/);
    expect(m.missingSkills).toEqual(expect.arrayContaining(['Kubernetes', 'Go', 'Terraform']));
  });

  it('flags sponsorship blockers for students who need a visa', () => {
    const intl = profile({ ...me, needsSponsorship: true });
    const m = scoreLocally({ ...base, role: 'Machine Learning Intern', description: 'Python. U.S. citizenship is required for this role.' }, intl);
    expect(m.flags.join(' ')).toMatch(/sponsor|citizenship/i);
    expect(m.score).toBeLessThanOrEqual(40);
  });

  it('flags degree mismatches from SimplifyJobs tags', () => {
    const m = scoreLocally({ ...base, role: 'Research Intern', description: '', tags: ['internship', 'PhD'] }, me);
    expect(m.flags.join(' ')).toMatch(/PhD/);
  });

  it('stays neutral and gives guidance with an empty profile', () => {
    const m = scoreLocally({ ...base, role: 'Data Intern', description: 'SQL' }, profile());
    expect(m.score).toBeGreaterThan(40);
    expect(m.gaps.join(' ')).toMatch(/Add your skills/);
  });

  it('changes the profile hash only when scoring inputs change', () => {
    expect(profileHash(me)).toBe(profileHash(profile({ ...me, name: 'Someone else', school: 'X' })));
    expect(profileHash(me)).not.toBe(profileHash(profile({ ...me, skills: ['Rust'] })));
  });

  it('filters irrelevant postings at ingestion', () => {
    const f = DEFAULT_SETTINGS.filters;
    const job = { ...base, description: '', tags: [] as string[] };
    expect(isRelevant({ ...job, role: 'Machine Learning Intern' }, me, f)).toBe(true);
    expect(isRelevant({ ...job, role: 'Marketing Intern' }, me, f)).toBe(false);
    expect(isRelevant({ ...job, role: 'Senior ML Intern Manager' }, me, f)).toBe(false);
    expect(isRelevant({ ...job, role: 'Machine Learning Engineer' }, me, f)).toBe(false);
    expect(isRelevant({ ...job, role: 'Software Engineer', tags: ['internship', 'AI/ML/Data'] }, me, f)).toBe(true);
  });
});

describe('settings validation', () => {
  it('rejects bad values and keeps defaults', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      ai: { provider: 'evil' as never, dailyLimit: -5, batchSize: 99, baseUrl: 'javascript:alert(1)' },
      automation: { hour: 42, timezone: '"; drop' },
      sources: { boards: [{ ats: 'greenhouse', token: 'Good-Token' }, { ats: 'nope', token: 'x' }, { ats: 'lever', token: '../etc' }] as never },
      filters: { maxNewPerRefresh: 100000 },
    });
    expect(s.ai.provider).toBe('none');
    expect(s.ai.dailyLimit).toBe(0);
    expect(s.ai.batchSize).toBe(10);
    expect(s.ai.baseUrl).toBe('');
    expect(s.automation.hour).toBe(23);
    expect(s.automation.timezone).toBe(DEFAULT_SETTINGS.automation.timezone);
    expect(s.sources.boards).toEqual([{ ats: 'greenhouse', token: 'good-token', name: 'good-token' }]);
    expect(s.filters.maxNewPerRefresh).toBe(500);
  });

  it('normalises profiles', () => {
    const p = normalizeProfile({ gradYear: 1850 as never, degree: 'wizard' as never, skills: ['sklearn', 'SKLEARN'], links: { github: 'javascript:x', linkedin: 'https://linkedin.com/in/a', portfolio: '' } });
    expect(p.gradYear).toBeNull();
    expect(p.degree).toBe('');
    expect(p.skills).toEqual(['scikit-learn']);
    expect(p.links.github).toBe('');
    expect(p.links.linkedin).toBe('https://linkedin.com/in/a');
  });
});
