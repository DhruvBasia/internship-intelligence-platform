/**
 * Deterministic, synthetic network fixtures for the dev harness and tests.
 * Shapes mirror the real APIs (SimplifyJobs listings.json, Greenhouse, Lever,
 * Ashby, hnrss, Gemini); the content is generated, not copied.
 */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const COMPANIES = ['Northwind AI', 'Lumen Labs', 'Quanta Robotics', 'Bluefin Data', 'Helix Health', 'Orbital Systems', 'Copperleaf', 'Nimbus Cloud', 'Sable Security', 'Vertex Quant', 'Paperplane', 'Kestrel Maps', 'Arcadia Games', 'Tidal Energy', 'Mosaic Bio', 'Lattice Finance', 'Fernwood', 'Pixelforge', 'Signal Peak', 'Redwood Research Lab'];
const TITLES = {
  'AI/ML/Data': ['Machine Learning Engineer Intern', 'Data Science Intern', 'AI Research Intern', 'Applied Scientist Intern', 'Computer Vision Intern', 'NLP Research Intern', 'Data Engineering Intern', 'Data Analyst Intern', 'ML Infrastructure Intern', 'GenAI Engineering Intern'],
  Software: ['Software Engineer Intern', 'Backend Engineering Intern', 'Frontend Engineer Intern', 'Full Stack Developer Intern', 'Site Reliability Engineering Intern', 'Mobile Engineering Intern (Android)'],
  Quant: ['Quantitative Research Intern', 'Quantitative Developer Intern'],
  Hardware: ['Hardware Engineering Intern', 'FPGA Design Intern', 'Embedded Firmware Intern'],
  Product: ['Product Manager Intern', 'Technical Program Manager Intern'],
};
const LOCATIONS = [['Bengaluru, India'], ['Hyderabad, India'], ['Remote'], ['San Francisco, CA'], ['New York, NY'], ['Seattle, WA', 'Remote in USA'], ['London, UK'], ['Pune, India', 'Remote'], ['Toronto, ON'], ['Singapore']];
const SKILLS_BY_CAT = {
  'AI/ML/Data': ['Python', 'PyTorch', 'TensorFlow', 'SQL', 'scikit-learn', 'Pandas', 'statistics', 'deep learning', 'NLP', 'computer vision', 'Spark', 'AWS', 'Docker', 'LLMs'],
  Software: ['Java', 'Go', 'TypeScript', 'React', 'Node.js', 'SQL', 'Docker', 'Kubernetes', 'AWS', 'REST APIs', 'distributed systems', 'Git'],
  Quant: ['Python', 'C++', 'statistics', 'probability', 'linear algebra', 'NumPy', 'time series'],
  Hardware: ['Verilog', 'FPGA', 'C', 'embedded software', 'PCB design', 'MATLAB'],
  Product: ['SQL', 'Figma', 'A/B testing', 'roadmapping', 'Excel'],
};

export function simplifyListings(now = Date.now()) {
  const r = rng(42);
  const out = [];
  let n = 0;
  for (const [category, titles] of Object.entries(TITLES)) {
    const count = category === 'AI/ML/Data' ? 70 : category === 'Software' ? 50 : 14;
    for (let i = 0; i < count; i++) {
      const company = pick(r, COMPANIES);
      const title = pick(r, titles);
      const id = `sim-${(++n).toString().padStart(4, '0')}`;
      const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
      const style = r();
      const url =
        style < 0.35
          ? `https://boards.greenhouse.io/${slug}/jobs/${4000000 + n}`
          : style < 0.55
            ? `https://jobs.lever.co/${slug}/${'0000000-0000-4000-8000-'.replace(/0/g, () => Math.floor(r() * 16).toString(16))}${n.toString(16).padStart(12, '0')}`
            : `https://careers.${slug}.example/jobs/${n}?utm_source=Simplify&ref=Simplify`;
      out.push({
        source: 'Simplify',
        category,
        company_name: company,
        id,
        title,
        active: r() > 0.06,
        terms: [pick(r, ['Summer 2027', 'Summer 2027', 'Summer 2027', 'Fall 2026', 'Winter 2027', 'Spring 2027'])],
        date_updated: Math.floor(now / 1000 - r() * 30 * 86400),
        date_posted: Math.floor(now / 1000 - r() * 75 * 86400),
        url,
        locations: pick(r, LOCATIONS),
        company_url: `https://simplify.jobs/c/${slug}`,
        is_visible: true,
        sponsorship: r() < 0.07 ? 'U.S. Citizenship is Required' : r() < 0.05 ? 'Does Not Offer Sponsorship' : 'Other',
        degrees: r() < 0.15 ? ["Master's", 'PhD'] : r() < 0.1 ? ['PhD'] : ["Bachelor's", "Master's"],
      });
    }
  }
  return out;
}

function description(company, title, category, r) {
  const skills = SKILLS_BY_CAT[category] ?? SKILLS_BY_CAT.Software;
  const need = [...skills].sort(() => r() - 0.5).slice(0, 5);
  const nice = [...skills].sort(() => r() - 0.5).slice(0, 2);
  const grad = 2026 + Math.floor(r() * 3);
  return {
    html: `<p>${company} is hiring a <strong>${title}</strong> to join our team for a 12-week internship.</p><h3>What you'll do</h3><ul><li>Ship production work alongside senior engineers</li><li>Own a scoped project end to end and present it at the end of the summer</li></ul><h3>What we're looking for</h3><ul><li>Currently pursuing a Bachelor's or Master's degree, graduating between December ${grad} and June ${grad + 1}</li><li>Experience with ${need.join(', ')}</li><li>Nice to have: ${nice.join(' and ')}</li></ul>`,
    text: `${company} is hiring a ${title} for a 12-week internship.\n\nWhat you'll do\n• Ship production work alongside senior engineers\n• Own a scoped project end to end\n\nWhat we're looking for\n• Currently pursuing a Bachelor's or Master's degree, graduating between December ${grad} and June ${grad + 1}\n• Experience with ${need.join(', ')}\n• Nice to have: ${nice.join(' and ')}`,
  };
}

function categoryOf(title) {
  for (const [cat, titles] of Object.entries(TITLES)) if (titles.includes(title)) return cat;
  return /data|ml|ai|learning|vision|nlp/i.test(title) ? 'AI/ML/Data' : 'Software';
}

export function greenhouseBoard(token) {
  const r = rng(token.length * 97 + token.charCodeAt(0));
  const company = token.replace(/\b\w/g, (c) => c.toUpperCase());
  const titles = ['Machine Learning Intern (Summer 2027)', 'Software Engineering Intern, Infrastructure', 'Research Scientist Intern, LLMs', 'Senior Staff Engineer, Platform', 'Data Analyst Intern', 'Account Executive', 'Security Engineering Intern'];
  return {
    jobs: titles.map((title, i) => {
      const d = description(company, title, categoryOf(title), r);
      return {
        id: 7000 + i,
        title,
        absolute_url: `https://job-boards.greenhouse.io/${token}/jobs/${7000 + i}`,
        location: { name: pick(r, ['San Francisco, CA', 'Remote - US', 'Bengaluru, India', 'London, UK']) },
        content: d.html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        first_published: new Date(Date.now() - r() * 20 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        company_name: company,
        metadata: [{ name: 'Location Type', value: pick(r, ['Hybrid', 'Remote', 'On-site']) }],
        departments: [{ name: 'Engineering' }],
      };
    }),
    meta: { total: titles.length },
  };
}

export function greenhouseJob(token, id) {
  const r = rng(Number(id) || 1);
  const company = token.replace(/\b\w/g, (c) => c.toUpperCase());
  const title = pick(r, [...TITLES['AI/ML/Data'], ...TITLES.Software]);
  const d = description(company, title, categoryOf(title), r);
  return { id: Number(id), title, absolute_url: `https://job-boards.greenhouse.io/${token}/jobs/${id}`, location: { name: 'Bengaluru, India' }, content: d.html, company_name: company, first_published: new Date().toISOString() };
}

export function leverPostings(token) {
  const r = rng(token.length * 31);
  const company = token.replace(/\b\w/g, (c) => c.toUpperCase());
  return ['Data Science Intern', 'Backend Engineer', 'Applied ML Intern - Perception'].map((text, i) => {
    const d = description(company, text, categoryOf(text), r);
    return {
      id: `lev-${token}-${i}`,
      text,
      hostedUrl: `https://jobs.lever.co/${token}/lev-${token}-${i}`,
      categories: { location: 'Hyderabad, India', commitment: /intern/i.test(text) ? 'Internship' : 'Full-time', team: 'Engineering' },
      descriptionPlain: d.text,
      lists: [],
      createdAt: Date.now() - i * 86400000,
      workplaceType: 'hybrid',
    };
  });
}

export function ashbyBoard(token) {
  const r = rng(token.length * 13);
  const company = token.replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    jobs: ['Research Engineer Intern', 'Product Designer', 'Software Engineer Intern (Summer 2027)'].map((title, i) => {
      const d = description(company, title, categoryOf(title), r);
      return {
        id: `ash-${token}-${i}`,
        title,
        location: 'Remote',
        employmentType: /intern/i.test(title) ? 'Intern' : 'FullTime',
        isRemote: true,
        descriptionPlain: d.text,
        publishedAt: new Date(Date.now() - i * 2 * 86400000).toISOString(),
        jobUrl: `https://jobs.ashbyhq.com/${token}/ash-${token}-${i}`,
        isListed: true,
      };
    }),
  };
}

export function careersPage(url) {
  const r = rng(url.length);
  const company = (/careers\.([a-z]+)\./.exec(url)?.[1] ?? 'Example').replace(/^./, (c) => c.toUpperCase());
  const title = pick(r, TITLES['AI/ML/Data']);
  const d = description(company, title, 'AI/ML/Data', r);
  const ld = { '@context': 'https://schema.org', '@type': 'JobPosting', title, description: d.html, hiringOrganization: { '@type': 'Organization', name: company }, jobLocation: { '@type': 'Place', address: { addressLocality: 'Bengaluru', addressCountry: 'IN' } }, datePosted: new Date().toISOString().slice(0, 10) };
  return `<!doctype html><html><head><title>${title} | ${company}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${title}</h1>${d.html}</body></html>`;
}

export function hnRss() {
  const items = [
    ['Paperplane (YC W25) Is Hiring Machine Learning Interns in Bengaluru', 'https://paperplane.example/careers'],
    ['Kestrel Maps (YC S24) is hiring a founding engineer', 'https://kestrel.example/jobs'],
    ['Lumen Labs Is Hiring Summer Research Interns (Remote)', 'https://lumen.example/interns'],
  ];
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Hacker News: Jobs</title>${items
    .map(([t, l], i) => `<item><title><![CDATA[${t}]]></title><link>${l}</link><description><![CDATA[<p>Article URL: ${l}</p>]]></description><pubDate>${new Date(Date.now() - i * 86400000).toUTCString()}</pubDate></item>`)
    .join('')}</channel></rss>`;
}

/** A believable stand-in for Gemini: scores postings by keyword overlap with the candidate block. */
export function fakeGemini(body) {
  const payload = JSON.parse(body || '{}');
  const prompt = payload.contents?.[0]?.parts?.[0]?.text ?? '';
  const wantsJson = payload.generationConfig?.responseMimeType === 'application/json';
  if (!wantsJson) {
    if (/health check/i.test(payload.systemInstruction?.parts?.[0]?.text ?? '')) return reply('OK');
    const name = /Name: (.+)/.exec(prompt)?.[1] ?? 'Alex';
    const company = /Company: (.+)/.exec(prompt)?.[1] ?? 'your team';
    const title = /Title: (.+)/.exec(prompt)?.[1] ?? 'the internship';
    return reply(
      `Dear ${company} hiring team,\n\nI'm applying for the ${title} role. (This is a dev-harness placeholder letter; a real AI key writes one from your resume.)\n\nIn my coursework and projects I've built and shipped end-to-end systems, and the problems your team describes are the ones I most want to work on next.\n\nI'd welcome the chance to bring that same care to ${company}. Thank you for your time.\n\nSincerely,\n${name}`,
    );
  }
  const skills = (/Skills: (.+)/.exec(prompt)?.[1] ?? '').toLowerCase().split(/,\s*/).filter(Boolean);
  const postings = [...prompt.matchAll(/<posting id="([^"]+)">([\s\S]*?)<\/posting>/g)];
  const results = postings.map(([, id, text]) => {
    const t = text.toLowerCase();
    const hits = skills.filter((s) => t.includes(s));
    const skillScore = Math.min(95, 35 + hits.length * 12);
    const title = (/Title: (.+)/.exec(text)?.[1] ?? '').toLowerCase();
    const senior = /senior|staff|principal/.test(title) && !/intern/.test(title);
    const phd = /phd/.test(t) && !/bachelor/.test(t);
    return {
      id,
      skills: skillScore,
      role: /intern/.test(t) ? 80 : 45,
      level: senior ? 15 : phd ? 30 : 78,
      location: /remote|bengaluru|india|hyderabad/.test(t) ? 85 : 55,
      summary: hits.length ? `Solid overlap on ${hits.slice(0, 3).join(', ')}; worth applying.` : 'Limited overlap with your listed skills.',
      strengths: hits.slice(0, 3).map((h) => `You list ${h}, which the posting asks for`),
      gaps: senior ? ['Role is senior-level'] : hits.length < 2 ? ['Few of the listed skills appear in your profile'] : [],
      tips: ['Lead with your most relevant project in the first two lines'],
      flags: senior ? ['Senior role, not an internship'] : phd ? ['Appears to target PhD students'] : [],
      matched_skills: hits,
      missing_skills: [],
    };
  });
  return reply(JSON.stringify({ results }));
}

function reply(text) {
  return { status: 200, text: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) };
}

export const GEMINI_MODELS = {
  models: [
    { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash (latest)', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-flash-lite-latest', displayName: 'Gemini Flash-Lite (latest)', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
  ],
};

/**
 * Synthetic inbox for the Gmail fake. Dates are relative to "now" so the
 * fixtures never go stale. Companies and people are invented.
 */
export function sampleInbox(now = Date.now()) {
  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const msgs = [
    { from: 'Placement Cell GGSIPU <cpc@ipu.ac.in>', subject: 'Northwind AI: Machine Learning Intern | Registration open', body: `Dear students,\nNorthwind AI is hiring Machine Learning Interns (6 months, stipend Rs 40,000). B.Tech AI&DS / CSE 2027 batch eligible.\nRegister on POD before ${fmt(now + 3 * day)}, 11:59 PM.\nRegards, CPC`, at: now - 2 * day },
    { from: 'Lumen Labs Recruiting <no-reply@lumenlabs.ai>', subject: 'Thank you for applying to Lumen Labs', body: 'Hi Dhruv, we have received your application for the Data Science Intern role. Our team will review it and get back to you.', at: now - 6 * day },
    { from: 'Lumen Labs Recruiting <no-reply@lumenlabs.ai>', subject: 'Lumen Labs: Online assessment for Data Science Intern', body: `Next step: please complete the HackerRank coding assessment by ${fmt(now + 4 * day)} 6:00 PM IST. The test link is valid for 72 hours.`, at: now - 1 * day },
    { from: 'Kestrel Maps Talent <talent@kestrelmaps.com>', subject: 'Interview invitation – Software Engineer Intern', body: `Congratulations! You have been shortlisted. Your technical interview with Kestrel Maps is scheduled on ${fmt(now + 2 * day)} at 3:30 PM IST on Google Meet.`, at: now - 0.5 * day },
    { from: 'Sable Security Careers <careers@sablesecurity.io>', subject: 'Update on your application', body: 'Thank you for your interest in Sable Security. Unfortunately, we will not be moving forward with your application at this time.', at: now - 3 * day },
    { from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>', subject: '30+ new jobs for "machine learning intern"', body: 'Jobs you may be interested in…', at: now - 1 * day },
    { from: 'Internshala <no-reply@internshala.com>', subject: 'Your OTP for login is 482910', body: 'Use this one-time password to log in.', at: now - 1 * day },
    { from: 'Corizo <hello@corizo.in>', subject: 'Get an IBM-associated training & internship program certificate', body: 'Enroll now! Limited time offer, 60% off.', at: now - 2 * day },
    { from: 'MBZUAI Admissions <admissions@mbzuai.ac.ae>', subject: 'MBZUAI MSc application: reminder to submit your recommendation letters', body: `Your referees must submit their letters before the application deadline of ${fmt(now + 28 * day)}. Applications close at 5:00 PM Gulf time.`, at: now - 1 * day },
    { from: 'UPSC Online <noreply@upsc.gov.in>', subject: 'Registration number for your One Time Registration', body: 'Your OTR has been completed successfully. Keep your registration number safe for future examinations.', at: now - 4 * day },
    { from: 'IELTS India <ielts@idp.com>', subject: 'IELTS test booking confirmed', body: `Your IELTS Academic test is confirmed for ${fmt(now + 10 * day)}. Please arrive by 8:00 AM with your passport.`, at: now - 0.2 * day },
  ];
  return msgs.map((m, i) => ({
    id: (0x18f0000000 + i * 4097).toString(16),
    threadId: (0x18f0000000 + i * 4097 + 1).toString(16),
    from: m.from,
    subject: m.subject,
    body: m.body,
    internalDate: String(Math.round(m.at)),
    date: iso(m.at),
  }));
}

/** Route a fake UrlFetchApp request to a fixture. */
export function fixtureFetch(req) {
  const u = req.url;
  let m;
  if (/raw\.githubusercontent\.com\/SimplifyJobs\//.test(u)) return { status: 200, text: JSON.stringify(simplifyListings()) };
  if ((m = /boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs\/(\d+)/.exec(u))) return { status: 200, text: JSON.stringify(greenhouseJob(m[1], m[2])) };
  if ((m = /boards-api\.greenhouse\.io\/v1\/boards\/([^/?]+)\/jobs/.exec(u))) return /^(nope|missing)/.test(m[1]) ? { status: 404, text: '{}' } : { status: 200, text: JSON.stringify(greenhouseBoard(m[1])) };
  if ((m = /api\.lever\.co\/v0\/postings\/([^/?]+)\/([^/?]+)/.exec(u))) return { status: 200, text: JSON.stringify(leverPostings(m[1])[0]) };
  if ((m = /api\.lever\.co\/v0\/postings\/([^/?]+)/.exec(u))) return { status: 404, text: '{"ok":false}' };
  if ((m = /api\.ashbyhq\.com\/posting-api\/job-board\/([^/?]+)/.exec(u))) return { status: 404, text: '{}' };
  if (/hnrss\.org/.test(u)) return { status: 200, text: hnRss() };
  if (/weworkremotely\.com/.test(u)) return { status: 503, text: 'unavailable' };
  if (/generativelanguage\.googleapis\.com\/v1beta\/models\?/.test(u)) {
    return req.headers['x-goog-api-key'] === 'AIzaBAD-key-for-tests-000000' ? { status: 400, text: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) } : { status: 200, text: JSON.stringify(GEMINI_MODELS) };
  }
  if (/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent/.test(u)) return fakeGemini(req.payload);
  if (/careers\.[a-z]+\.example\//.test(u)) return { status: 200, text: careersPage(u) };
  if (/job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com/.test(u)) return { status: 200, text: '<html><head><title>Job</title></head><body>JS app</body></html>' };
  return { status: 404, text: 'not found' };
}
