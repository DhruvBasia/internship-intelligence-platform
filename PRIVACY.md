# InternIQ privacy policy

_Last updated: November 2026_

InternIQ is an open-source internship tracker that runs on Google Apps Script. This policy explains what happens to your data when you use a deployment of it.

## Who can see your data

InternIQ runs **as you**, inside your own Google account. The person who deployed the app (the developer) **cannot see your jobs, profile, notes, cover letters, settings or API keys**. There is no InternIQ server and no shared database.

## What is stored, and where

| Data | Where it lives |
|---|---|
| Tracked jobs, notes, scores, cover letters, activity history | A Google Sheet named "InternIQ: my internship tracker" in your own Google Drive |
| Profile (skills, target roles, resume text), settings | Your private Apps Script user properties |
| AI API keys you add | Your private Apps Script user properties. Never written to the sheet, never sent to the browser |

You can open, export, share or delete the sheet like any other file.

## What is sent to third parties

- **Job sources.** InternIQ fetches public listings from SimplifyJobs (GitHub), Greenhouse, Lever and Ashby job-board APIs, and optionally Hacker News and We Work Remotely. These requests contain no personal data.
- **Job pages you add by link.** InternIQ fetches that page to read the posting.
- **AI providers (optional, only if you add your own key).** When a job is analysed or a cover letter drafted, the posting text and your profile go to the provider you chose (Google Gemini, Groq, OpenRouter, or another OpenAI-compatible API), under your own key and that provider's terms. Email addresses, phone numbers and LinkedIn links are removed from your resume text first. Free tiers of some providers may use prompts to improve their models; read your provider's terms.
- **Email.** If you turn on the daily digest, it is sent with your own Gmail account, to your own address only.

## Email scanning (personal deployments only)

Deployments built with mail enabled also ask for **read-only Gmail access** (`gmail.readonly`). Every hour they search your inbox for placement, application, admissions, exam and deadline emails and store the subject, sender, a short snippet and any detected date in your own sheet's Mail tab. InternIQ never sends, replies to, deletes, labels or archives email, and email content never leaves your Google account unless you run AI analysis on a job.

## Google permissions

InternIQ asks for: managing spreadsheets (to create and update your tracker sheet), connecting to external services (job boards and your AI provider), sending email as you (the optional digest, to yourself), managing triggers (your optional daily refresh), and your email address (to address the digest). It does not read your Gmail or browse your Drive.

## Deleting your data

**Settings → Data & privacy → Delete all my data** erases every job, note, cover letter, setting, API key and scheduled refresh, then leaves the empty sheet in your Drive for you to trash. You can also revoke InternIQ's access at any time at <https://myaccount.google.com/permissions>.

## Contact

Questions or issues: open an issue at <https://github.com/DhruvBasia/internship-intelligence-platform/issues>.
