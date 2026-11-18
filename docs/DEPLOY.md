# Deploying your own InternIQ

InternIQ v3 runs on free tiers:

| Piece | Where | What it does |
| --- | --- | --- |
| Web app | GitHub Pages | Static site (`dist/web`), published by `.github/workflows/pages.yml` |
| Sign-in | Supabase Auth | "Continue with Google" (basic profile only) |
| Database | Supabase Postgres | One set of tables for everyone, isolated per user by row-level security |
| API | Supabase Edge Function `api` | Every app action, the Gmail OAuth callback, the hourly worker, calendar feeds |
| Scheduler | `pg_cron` + `pg_net` in Supabase | Calls the API's `/cron` endpoint every hour |
| Gmail (optional) | Google OAuth, `gmail.readonly` | Each student connects their own inbox, read-only |

Total cost: ₹0. Supabase's free plan (500 MB database, 500k function calls a month) comfortably covers a few hundred students. Supabase pauses free projects after a week with no activity at all; the hourly job keeps it awake while anyone has automation or Gmail on.

## 1. Supabase project

1. Sign up at [supabase.com](https://supabase.com) (sign in with GitHub is easiest) and create a project. Pick the region closest to your users (Mumbai for India). Save the database password somewhere safe.
2. Note the **Project URL** and the **Publishable key** (Project Settings → API Keys). The publishable key is public by design.

## 2. Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com):

1. Create a project (e.g. "InternIQ").
2. **APIs & Services → Library**: enable the **Gmail API** (only needed for inbox tracking).
3. **Google Auth Platform → Branding**: app name *InternIQ*, your support email, app home page `https://<you>.github.io/<repo>/`, privacy policy `…/privacy.html`, terms `…/terms.html`. Authorized domains: `<you>.github.io` and `<project-ref>.supabase.co`. Do not upload a logo yet (a logo triggers brand verification).
4. **Audience**: User type *External*. Click **Publish app** so it is *In production*. (In *Testing*, Gmail access silently expires after 7 days and only listed test users can sign in.)
5. **Data access**: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `.../auth/gmail.readonly`.
6. **Clients → Create client → Web application**. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback` (sign-in)
   - `https://<project-ref>.supabase.co/functions/v1/api/gmail/callback` (Gmail)

   Keep the client ID and client secret for the next steps.

**About Google's warning.** Sign-in uses only basic scopes, so students see a normal Google sign-in. Connecting Gmail asks for a *restricted* scope; until Google verifies the app, students see "Google hasn't verified this app" and must click *Advanced → Go to InternIQ*, and at most 100 people can grant Gmail access. That is fine for a batch. Beyond that, Google requires verification, and for restricted scopes an annual third-party security assessment.

## 3. Server

In your own terminal, from the repo:

```bash
npm ci
npx supabase login
npm run setup
```

`setup` asks for the values above (it hides the Google client secret as you type), then:

- writes `private/server.env` (git-ignored: **back it up**, because `INTERNIQ_SECRETS_KEY` decrypts stored AI keys and Gmail tokens) and `deploy/public.json` (public settings, committed);
- links the project, creates the tables (`supabase db push`), stores the secrets, deploys the `api` function and checks `/health`.

Then in the Supabase dashboard:

- **Authentication → URL Configuration**: Site URL = your app URL; add the app URL and `http://localhost:5178/` to Redirect URLs.
- **Authentication → Sign In / Providers → Google**: enable it and paste the same client ID and secret.

## 4. Web app

Commit `deploy/public.json` and push. In the GitHub repo, **Settings → Pages → Build and deployment → Source: GitHub Actions**. The *Publish web app* workflow builds and publishes the site; the URL is shown on the workflow run.

## 5. First sign-in

Open the app, sign in with the owner email you gave `setup`, and in **Owner dashboard** click **Turn on hourly automation**. Then share the link.

## Updating

```bash
npm run deploy:server          # new server code
npm run deploy:server -- --db  # also apply new database migrations
git push                       # new web app (GitHub Pages)
```

## Local development

```bash
npm run dev:demo   # http://localhost:5178, demo data, fake Gmail and AI, simulated sign-in
npm run dev        # empty account (shows onboarding)
```

The dev server runs the real API code on PGlite (Postgres in WebAssembly) with the real migrations and row-level security, so what works locally works on Supabase. Tests do the same: `npm test`.

## Settings reference (server secrets)

| Name | Meaning |
| --- | --- |
| `INTERNIQ_APP_URL` | Public URL of the web app (OAuth redirects, CORS) |
| `INTERNIQ_ALLOWED_ORIGINS` | Extra browser origins allowed to call the API (e.g. `http://localhost:5178`) |
| `INTERNIQ_OWNER_EMAIL` | Your account: gets the owner dashboard and your private seed from `private/` |
| `INTERNIQ_ADMIN_EMAILS` | Comma-separated emails that can open the owner dashboard |
| `INTERNIQ_SECRETS_KEY` | 32-byte base64 key for encrypting AI keys and Gmail tokens. Never change it. |
| `INTERNIQ_CRON_SECRET` | Shared secret for the hourly `/cron` call |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client for Gmail connect |

Supabase provides `SUPABASE_URL` and the API keys to the function automatically.
