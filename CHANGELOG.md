# Changelog

## 2.0.0 (unreleased)

A rebuild of InternIQ for production use by many students. Still Google Apps Script; everything else is new.

### Added
- Multi-user: runs as the user accessing the app; each user's data in their own Drive and user properties.
- Free four-dimension matcher (skills, role, eligibility, location) on every posting, with strengths, gaps, tips and eligibility flags (PhD-only, senior, graduation window, citizenship/sponsorship).
- Bring-your-own free AI: Gemini, Groq, OpenRouter (free models only) or any OpenAI-compatible API, with key verification, model auto-selection and fallback, batching, daily budget and cooldowns.
- Follow companies via public Greenhouse, Lever and Ashby boards, with a verified suggestions list; add any job by URL (ATS APIs, JSON-LD, meta fallbacks).
- Season-aware SimplifyJobs ingestion with category, age and per-refresh caps; description enrichment for title-only postings.
- Onboarding wizard, Home dashboard, Discover filters and bulk actions, kanban Pipeline, Insights charts, job drawer with score breakdown, notes, deadlines, follow-ups, Google Calendar links and cover-letter editor.
- Hourly background worker: daily refresh at the user's local hour, AI queue draining, email digest.
- CSV/TSV import (Excel, Sheets, v1 format), import from any Google Sheet, research-programmes pack (32 recurring programmes), CSV export, delete-all-data.
- In-place v1 migration (jobs, cover letters, profile, Gemini key, retired v1 trigger).
- TypeScript + esbuild build, 67 tests including end-to-end runs of the built bundle against Apps Script fakes, local dev harness, GitHub Actions CI and optional deploy.

### Security and privacy
- API keys sent in headers, stored only in user properties, never returned to the browser.
- Default X-Frame-Options (v1 allowed framing by any site).
- All scraped text rendered escaped; links restricted to http(s); digest email fully escaped.
- Spreadsheet formula-injection guard on every write.
- Contact details stripped from resume text before it is sent to an AI provider.
- Narrower OAuth scopes: no Gmail read or Drive access.
- Per-user rate limits and input validation on every RPC; internal errors never leak details.

### Fixed (from v1)
- Failed AI calls were stored as score 0 and retried forever; now tracked as failed with attempts.
- Hard-coded Summer 2026 SimplifyJobs list; dead Hacker News and ai-jobs.net feeds.
- `intern` keyword matched "International" and "Internal".
- Every action re-read every sheet and sent all data back; activity log wrote one row per call.
