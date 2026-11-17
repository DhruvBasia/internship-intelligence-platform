import { describe, expect, it } from 'vitest';
import {
  extractFromHtml,
  parseAshby,
  parseAtsUrl,
  parseGreenhouse,
  parseHn,
  parseLever,
  parseRss,
  parseSimplify,
  simplifyUrlCandidates,
  splitHnTitle,
  splitPageTitle,
} from '../src/server/sources/parsers';
import { mapStage, parseDelimited, rowsToRawJobs } from '../src/server/importers';
import { starterPackTsv, STARTER_PACK_SIZE } from '../src/server/starterPack';
import { ashbyBoard, careersPage, greenhouseBoard, hnRss, leverPostings, simplifyListings } from '../tools/fixtures.mjs';

const board = (ats: 'greenhouse' | 'lever' | 'ashby', token: string) => ({ ats, token, name: '' });

describe('SimplifyJobs', () => {
  it('targets next summer after June and falls back a year', () => {
    expect(simplifyUrlCandidates(new Date('2026-11-17'))[0]).toContain('Summer2027-Internships');
    expect(simplifyUrlCandidates(new Date('2026-03-01'))[0]).toContain('Summer2026-Internships');
    expect(simplifyUrlCandidates(new Date('2026-11-17'))[1]).toContain('Summer2026-Internships');
  });

  it('keeps active, recent postings in wanted categories, newest first', () => {
    const now = new Date();
    const all = simplifyListings(now.getTime());
    const jobs = parseSimplify(JSON.stringify(all), { categories: ['AI/ML/Data'], maxAgeDays: 30, now });
    expect(jobs.length).toBeGreaterThan(5);
    expect(jobs.every((j) => j.tags.includes('AI/ML/Data') && j.tags.includes('internship'))).toBe(true);
    const cutoff = now.getTime() - 30 * 86_400_000;
    expect(jobs.every((j) => Date.parse(j.postedAt) >= cutoff)).toBe(true);
    for (let i = 1; i < jobs.length; i++) expect(jobs[i - 1]!.postedAt >= jobs[i]!.postedAt).toBe(true);
    const inactive = all.filter((x) => !x.active).map((x) => x.id);
    expect(jobs.some((j) => inactive.includes(j.sourceRef))).toBe(false);
  });

  it('normalises renamed categories and rejects garbage', () => {
    const now = new Date();
    const one = [{ company_name: 'A', title: 'ML Intern', url: 'https://a.example/1', category: 'Data Science, AI & Machine Learning', active: true, is_visible: true, date_posted: now.getTime() / 1000 }];
    expect(parseSimplify(JSON.stringify(one), { categories: ['AI/ML/Data'], maxAgeDays: 10, now })).toHaveLength(1);
    const bad = [{ company_name: 'A', title: 'X', url: 'javascript:alert(1)', active: true, date_posted: now.getTime() / 1000 }];
    expect(parseSimplify(JSON.stringify(bad), { categories: [], maxAgeDays: 10, now })).toHaveLength(0);
    expect(() => parseSimplify('<html>', { categories: [], maxAgeDays: 10, now })).toThrow();
  });
});

describe('company boards', () => {
  it('parses Greenhouse with escaped HTML content', () => {
    const jobs = parseGreenhouse(JSON.stringify(greenhouseBoard('acme')), board('greenhouse', 'acme'));
    expect(jobs.length).toBeGreaterThan(3);
    const j = jobs[0]!;
    expect(j.description).toContain("What you'll do");
    expect(j.description).not.toMatch(/&lt;|<p>/);
    expect(j.url).toMatch(/^https:\/\/job-boards\.greenhouse\.io\/acme\/jobs\//);
    expect(j.location).toMatch(/·/);
  });

  it('parses Lever and marks internship commitments', () => {
    const jobs = parseLever(JSON.stringify(leverPostings('quanta')), board('lever', 'quanta'));
    expect(jobs.find((j) => j.role === 'Data Science Intern')?.tags).toContain('internship');
    expect(jobs.find((j) => j.role === 'Backend Engineer')?.tags).not.toContain('internship');
    expect(() => parseLever('{"ok":false}', board('lever', 'x'))).toThrow(/not found/);
  });

  it('parses Ashby and uses employmentType', () => {
    const jobs = parseAshby(JSON.stringify(ashbyBoard('modal')), board('ashby', 'modal'));
    expect(jobs.filter((j) => j.tags.includes('internship'))).toHaveLength(2);
    expect(jobs[0]!.location).toContain('Remote');
  });

  it('recognises ATS URLs and short forms', () => {
    expect(parseAtsUrl('https://boards.greenhouse.io/anthropic')).toEqual({ ats: 'greenhouse', token: 'anthropic', jobId: '' });
    expect(parseAtsUrl('https://job-boards.greenhouse.io/databricks/jobs/123456?gh_jid=1')).toEqual({ ats: 'greenhouse', token: 'databricks', jobId: '123456' });
    expect(parseAtsUrl('https://boards.greenhouse.io/embed/job_board?for=stripe&token=99')).toEqual({ ats: 'greenhouse', token: 'stripe', jobId: '99' });
    expect(parseAtsUrl('https://jobs.lever.co/palantir/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply')?.jobId).toBe('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
    expect(parseAtsUrl('https://jobs.ashbyhq.com/openai')).toEqual({ ats: 'ashby', token: 'openai', jobId: '' });
    expect(parseAtsUrl('lever:Zoox')).toEqual({ ats: 'lever', token: 'zoox', jobId: '' });
    expect(parseAtsUrl('https://example.com/careers')).toBeNull();
    expect(parseAtsUrl('Anthropic')).toBeNull();
  });
});

describe('RSS', () => {
  it('parses CDATA and entity-encoded items', () => {
    const items = parseRss(hnRss());
    expect(items).toHaveLength(3);
    expect(items[0]!.title).toContain('Paperplane');
    expect(() => parseRss('<html>nope</html>')).toThrow();
  });

  it('splits HN "is hiring" titles', () => {
    expect(splitHnTitle('Paperplane (YC W25) Is Hiring Machine Learning Interns in Bengaluru')).toEqual({ company: 'Paperplane', role: 'Machine Learning Interns', location: 'Bengaluru' });
    expect(splitHnTitle('Tinfoil (YC P25) is hiring an applied AI security engineer in San Francisco').company).toBe('Tinfoil');
    const jobs = parseHn(hnRss());
    expect(jobs[2]!.location).toBe('Remote');
  });
});

describe('job pages', () => {
  it('prefers JSON-LD JobPosting', () => {
    const p = extractFromHtml(careersPage('https://careers.lumen.example/jobs/1'), 'https://careers.lumen.example/jobs/1');
    expect(p.structured).toBe(true);
    expect(p.company).toBe('Lumen');
    expect(p.location).toContain('Bengaluru');
    expect(p.description).toContain('internship');
  });

  it('falls back to titles and meta tags', () => {
    const html = '<html><head><title>Data Science Intern - Fernwood Careers</title><meta property="og:site_name" content="Fernwood"></head><body><p>' + 'Work on data. '.repeat(40) + '</p></body></html>';
    const p = extractFromHtml(html, 'https://jobs.fernwood.example/1');
    expect(p.structured).toBe(false);
    expect(p.role).toBe('Data Science Intern');
    expect(p.company).toBe('Fernwood Careers');
    expect(p.description.length).toBeGreaterThan(100);
    expect(splitPageTitle('Acme | Software Engineer Intern')).toEqual({ role: 'Software Engineer Intern', company: 'Acme' });
    expect(splitPageTitle('ML Intern at Acme AI | Lever')).toEqual({ role: 'ML Intern', company: 'Acme AI' });
  });
});

describe('spreadsheet import', () => {
  it('parses quoted CSV and TSV', () => {
    expect(parseDelimited('a,b\n"x, y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
    expect(parseDelimited('a\tb\r\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('maps common trackers and the v1 format', () => {
    const csv = 'Job Title,Company,Link,Status,Deadline,Notes\nML Intern,Acme,https://acme.example/1,Interview scheduled,2026-12-01,Referral from Priya\n,MissingRole,,,,\n';
    const { jobs, skipped } = rowsToRawJobs(parseDelimited(csv));
    expect(skipped).toBe(1);
    expect(jobs[0]).toMatchObject({ role: 'ML Intern', company: 'Acme', url: 'https://acme.example/1', stage: 'interviewing', deadline: '2026-12-01', notes: 'Referral from Priya' });
    expect(mapStage('Not Started')).toBe('discovered');
    expect(mapStage('Offered')).toBe('offer');
    expect(mapStage('Rejected')).toBe('rejected');
    expect(mapStage('Applied')).toBe('applied');
  });

  it('ships a valid research programs pack', () => {
    const { jobs, skipped } = rowsToRawJobs(parseDelimited(starterPackTsv()));
    expect(skipped).toBe(0);
    expect(jobs).toHaveLength(STARTER_PACK_SIZE);
    expect(jobs.every((j) => /^https:\/\//.test(j.url))).toBe(true);
    expect(jobs.every((j) => j.deadlineText || j.deadline)).toBe(true);
  });

  it('rejects tables without role and company columns', () => {
    expect(() => rowsToRawJobs(parseDelimited('foo,bar\n1,2'))).toThrow(/header/);
  });
});
