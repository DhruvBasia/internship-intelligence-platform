# Deploying InternIQ

InternIQ runs entirely on Google Apps Script. Each person who opens your web app link runs it **as themselves**: their data goes into a spreadsheet in their own Drive, their settings and API keys into their own private script properties. You pay nothing, and you can't see anyone's data.

## 1. One-time setup

```bash
npm install
npm install -g @google/clasp
clasp login
```

Turn on the Apps Script API for your Google account at <https://script.google.com/home/usersettings> (clasp needs it).

## 2. Create (or connect) the Apps Script project

**New project**

```bash
clasp create-script --type webapp --title "InternIQ" --rootDir dist
```

This writes `.clasp.json` (git-ignored) with your script id.

**Upgrading the existing v1 project in place.** If you already deployed v1, reuse its script id so everyone's v1 data migrates automatically:

1. Open the v1 project at script.google.com, then **Project Settings → Script ID**, and copy the id.
2. `cp .clasp.json.example .clasp.json` and paste the id.
3. Deploy as below. On first open, each user's v1 "Internships" sheet is converted, their Gemini key and profile carry over, the old sheets are renamed `v1 backup · …`, and the old daily trigger retires itself.

## Personal build: Gmail scanning and your own data

For your own deployment, create a git-ignored `private/` folder:

| File | Effect |
|---|---|
| `private/config.json` | `{ "mail": true }` compiles in the Mail section and adds the read-only scope `gmail.readonly` plus the Gmail advanced service to the manifest |
| `private/seed.json` | Your profile, dated roadmap tasks and programme stages, imported once on first open |
| `private/ratings.json` | Your fit rating and note per catalogue programme |

`npm run build` prints `build personal · mail on` when these are picked up. CI and anyone cloning the repo get the public build (no Gmail, no personal data). Open the deployed app with the Google account whose inbox you want scanned.

## 3. Push and deploy

```bash
npm run deploy
```

This typechecks, runs the tests, builds `dist/`, pushes it, and creates a deployment. It prints a **deployment id**. Keep it: to ship updates **without changing the URL**, run

```bash
npm run deploy -- <deploymentId>
```

The web app settings come from `appsscript.json`:

| Setting | Value | Why |
|---|---|---|
| Execute as | User accessing the web app | Each student's data stays in their own Drive |
| Who has access | Anyone with a Google account | Share one link with your whole class |

Open the URL printed by clasp (or **Deploy → Manage deployments** in the editor).

## 4. What users see the first time

Google shows an OAuth consent screen listing the permissions in `appsscript.json`:

| Scope | Used for |
|---|---|
| `spreadsheets` | Create and update the user's own tracker sheet |
| `script.external_request` | Fetch public job boards and call the AI provider the user chose |
| `script.send_mail` | Send the optional daily digest to the user's own address |
| `script.scriptapp` | Install the user's optional hourly background trigger |
| `userinfo.email` | Address the digest and show who is signed in |

v1 asked for full Gmail and Drive access. v2 does not need either.

### "Google hasn't verified this app"

Until the app is verified, users see this warning and click **Advanced → Go to InternIQ (unsafe)**. That's normal for student projects, and unverified apps can be used by up to 100 users. To remove the warning and the cap:

1. In the Apps Script editor, **Project Settings → Google Cloud Platform project → Change project** to a standard GCP project you own.
2. In that project, configure the **OAuth consent screen** (app name, support email, logo, the privacy policy at `PRIVACY.md` published somewhere public, and the scopes above).
3. Submit for verification. Sensitive scopes (spreadsheets, send_mail) need a short demo video.

## 5. Optional: deploy from GitHub Actions

`.github/workflows/ci.yml` typechecks, tests and builds on every push. To deploy from Actions, add these repository secrets and run the workflow manually with **deploy** ticked:

| Secret | Value |
|---|---|
| `CLASPRC_JSON` | Contents of your `~/.clasprc.json` after `clasp login` |
| `SCRIPT_ID` | The Apps Script project id |
| `DEPLOYMENT_ID` | The deployment to update (keeps the URL stable) |

Treat `CLASPRC_JSON` like a password: it can edit your Apps Script projects.

## Quotas to know

Apps Script quotas are **per user**, so they don't add up across students. The ones that matter, for consumer Google accounts:

- **Script runtime:** 6 minutes per execution. Refreshes and AI batches stop at about 3 to 5 minutes and continue next hour.
- **Triggers:** 90 minutes of total trigger runtime per day. The hourly worker exits in about a second when there's nothing to do.
- **Email:** 100 recipients per day. The digest sends at most one email per day.
- **URL fetch:** 20,000 calls per day. A refresh with 20 followed companies uses about 25.

Check Google's current numbers at <https://developers.google.com/apps-script/guides/services/quotas>.
