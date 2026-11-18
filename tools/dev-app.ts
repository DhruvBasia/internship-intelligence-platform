/**
 * The local dev backend: the real HTTP handler on real Postgres (PGlite), one
 * signed-in student, fixture job sources, a fake Gemini, and a fake Gmail inbox.
 * Bundled and started by scripts/dev.mjs.
 */
import { sampleInbox } from './fixtures.mjs';
import { boot } from './harness';

export const DEV_EMAIL = 'owner@student.example';

export async function createDevApp(opts: { demo: boolean }) {
  const inbox = sampleInbox();
  const s = await boot({ email: DEV_EMAIL, inbox: () => inbox });
  if (opts.demo) await seedDemo(s);
  return {
    /** Forward a browser request to the handler as the dev student. */
    async handle(method: string, args: unknown[]): Promise<unknown> {
      return s.call(method, ...args);
    },
    /** Serve the Gmail OAuth callback and calendar feed like the real function would. */
    async raw(path: string): Promise<Response> {
      return s.request(path);
    },
    connectGmail: () => s.connectGmail(),
  };
}

async function seedDemo(s: Awaited<ReturnType<typeof boot>>): Promise<void> {
  await s.ok('saveProfile', {
    name: 'Dhruv',
    school: 'GGSIPU EDC',
    degree: 'bachelors',
    gradYear: 2027,
    skills: ['Python', 'PyTorch', 'SQL', 'scikit-learn', 'Pandas', 'Docker', 'React', 'GIS'],
    targetRoles: ['Machine Learning', 'Data Science', 'AI Research', 'Software Engineering'],
    locations: ['India', 'Bengaluru', 'Remote'],
    workModes: ['remote', 'hybrid'],
    needsSponsorship: true,
    resumeText: 'B.Tech CSE (AI & DS), GGSIPU EDC, 2023-2027.\nProjects: geospatial fire-risk analysis (Python, GeoPandas, Leaflet); agentic blockchain security with LangGraph; cognitive load detection with computer vision (OpenCV, React).\nSkills: Python, PyTorch, TensorFlow, SQL, Pandas, NumPy, Docker, Git, React, LangChain.',
    links: { github: 'https://github.com/DhruvBasia', linkedin: '', portfolio: '' },
  });
  await s.ok('saveSettings', { sources: { boards: [{ ats: 'greenhouse', token: 'northwind', name: 'Northwind' }, { ats: 'lever', token: 'quanta', name: 'Quanta' }] } });
  await s.ok('setSecret', 'gemini', 'AIzaGOOD-key-for-tests-00000000');
  await s.ok('completeOnboarding');
  await s.ok('importStarterPack');
  const r = await s.call('refreshNow');
  if (!r.ok) console.warn('demo refresh failed', r.error);
  const jobs = ((await s.ok('listJobs')).jobs as { id: string; score: number }[]).sort((a, b) => b.score - a.score);
  const plan: [string, number][] = [
    ['applied', 6],
    ['interviewing', 2],
    ['saved', 5],
    ['rejected', 2],
    ['offer', 1],
  ];
  let i = 0;
  for (const [stage, n] of plan) for (let k = 0; k < n && i < jobs.length; k++) await s.ok('updateJob', jobs[i++]!.id, { stage });
  await s.connectGmail();
  await s.ok('scanMail');
}
