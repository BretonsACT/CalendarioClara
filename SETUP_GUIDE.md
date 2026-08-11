# CalendarioClara — Setup Guide: Supabase + Netlify

Step-by-step guide to get the shift calendar running with a Supabase backend
(database + iCal edge function) and hosted on Netlify.

## How the app works (architecture)

- **`index.html`** — the whole app: React 18, Tailwind and the Supabase JS client
  are loaded from CDNs, so **there is no build step**. This is the only file that
  needs hosting.
- **Supabase** — stores shifts in a `shifts` table and serves the Google Calendar
  subscription feed via an edge function (`shifts-ics`).
- **Netlify** — hosts the static `index.html`. Netlify does *not* host the
  database or the calendar function; those stay on Supabase.

```
Browser (Netlify: index.html)
   │  reads/writes shifts
   ▼
Supabase (table: shifts)  ──►  Google Calendar (subscribes to shifts-ics feed)
```

## Before you start

- [ ] A [Supabase account](https://supabase.com) (free tier is enough)
- [ ] A [Netlify account](https://app.netlify.com) (free tier is enough)
- [ ] Node.js installed (for the Supabase CLI)
- [ ] Supabase CLI installed: `npm install -g supabase`

---

## Part 1 — Supabase (database + calendar feed)

> **Already done in this project** (skip or just verify):
> - Supabase project **NurseCalendar** exists, ref `jbbguvtvmddxcklxeeeb`
> - Folder is already linked to it (`supabase/.temp/linked-project.json`)
> - `create_table.sql` and the `shifts-ics` edge function are in the repo
> - `index.html` already contains the project URL and publishable key

### 1.1 Create the Supabase project

If you keep the existing project (recommended), skip to 1.2. To create a new one:

1. Go to https://supabase.com/dashboard → **New project**
2. Pick an organization, name it (e.g. `NurseCalendar`), set a strong DB password,
   choose a region close to your users (e.g. `eu-central-1` for Spain)
3. Note the **project URL** — it looks like `https://xxxx.supabase.co`

If you create a *new* project, see **3.1** — you must update the keys and the
calendar URL inside `index.html`.

### 1.2 Create the `shifts` table

1. In the Supabase dashboard: **SQL Editor** → **New query**
2. Paste the whole content of [`create_table.sql`](create_table.sql) and click **Run**
3. You should see "Success". The script:
   - creates the `shifts` table (`date` primary key, `shift_type`, `note`, `created_at`)
   - enables **Row Level Security**
   - allows anyone to **read** (the calendar is shared with the family)
   - allows anyone to **insert/update** (the app is protected by the UI password)

Verify: **Table Editor** → `shifts` should exist with the 4 columns.

### 1.3 Deploy the `shifts-ics` edge function

This function generates the iCal feed that Google Calendar subscribes to.

```bash
# 1. Log in (opens a browser window)
supabase login

# 2. Link this folder to the project (already done, re-run only if needed)
supabase link --project-ref jbbguvtvmddxcklxeeeb

# 3. If supabase/config.toml is missing, create it
supabase init

# 4. Deploy the function (important: --no-verify-jwt, see note below)
supabase functions deploy shifts-ics --no-verify-jwt
```

**Why `--no-verify-jwt`:** by default Supabase edge functions reject requests
without a valid login token. Google Calendar subscribes to the feed URL with no
auth headers, so the function must allow anonymous access. (The function only
reads public calendar data.)

The function automatically receives `SUPABASE_URL` and `SUPABASE_ANON_KEY`
environment variables — no secrets to configure.

**Verify the feed works:**

```bash
curl -i "https://jbbguvtvmddxcklxeeeb.supabase.co/functions/v1/shifts-ics"
```

You should get `HTTP/1.1 200` and a response starting with `BEGIN:VCALENDAR`.

### 1.4 Get the project URL and publishable key

1. Dashboard → **Project Settings** → **API**
2. Copy:
   - **Project URL**: `https://jbbguvtvmddxcklxeeeb.supabase.co`
   - **Publishable key** (starts with `sb_publishable_...`)
3. These are already set in `index.html` at lines ~304–307:

```js
const SUPABASE_URL = 'https://jbbguvtvmddxcklxeeeb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';   // paste your FULL publishable key
```

> The publishable key is **designed to be public** — it's safe to ship in a
> browser app. Never put the **secret key** in `index.html`.

---

## Part 2 — Netlify (hosting the site)

Netlify only needs `index.html`. The `supabase/` folder and `create_table.sql`
are development files — you can exclude them from what you upload.

### Option A — Netlify Drop (recommended, quickest)

1. Create a clean folder (e.g. `deploy/`) containing **only** `index.html`
2. Go to https://app.netlify.com/drop
3. Drag & drop that folder onto the page
4. Netlify uploads it and gives you a URL like `https://random-name.netlify.app`
5. Rename it: **Site configuration → Site details → Change site name**,
   e.g. `calendarioclara.netlify.app`

That's it — HTTPS is automatic and the site is live.

### Option B — Git + continuous deployment

Useful if you'll keep editing the site and want auto-deploys on push.

1. Create a **new** repository on GitHub (do *not* reuse the existing
   `encontrar-zapatillas` repo — this folder is not part of it)
2. From the `CalendarioClara` folder:

```bash
git init
git add index.html create_table.sql supabase/
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-user>/<repo-name>.git
git push -u origin main
```

3. In Netlify: **Add new site → Import an existing project → GitHub**
4. Authorize Netlify, pick the repo
5. Settings: **Build command** empty, **Publish directory** `.`
6. Click **Deploy site**

### Optional — keys via environment variables

Keeping the publishable key hardcoded in `index.html` is perfectly fine (it's
public by design). If you prefer not to, add a tiny build step in Netlify:

1. In Netlify: **Site configuration → Environment variables**, add
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
2. In `index.html`, replace the values with placeholders:
   ```js
   const SUPABASE_URL = 'REPLACE_SUPABASE_URL';
   const SUPABASE_KEY = 'REPLACE_SUPABASE_KEY';
   ```
3. In Netlify build settings set **Build command**:
   ```bash
   sed -i "s|REPLACE_SUPABASE_URL|$SUPABASE_URL|; s|REPLACE_SUPABASE_KEY|$SUPABASE_PUBLISHABLE_KEY|" index.html
   ```

This is optional — skip it unless you want the keys out of the file.

### Custom domain (optional)

1. Buy a domain (e.g. via Namecheap/Cloudflare)
2. Netlify: **Domain management → Add a domain**
3. Follow Netlify's instructions to point the domain (usually: add an `A` record
   or `CNAME`, or let Netlify manage DNS)
4. HTTPS is set up automatically (Let's Encrypt)

---

## Part 3 — After deployment

### 3.1 Google Calendar subscription

The app shows a **Google Calendar** button with the feed URL:

```
https://jbbguvtvmddxcklxeeeb.supabase.co/functions/v1/shifts-ics
```

- If you reused the same Supabase project, this URL is **unchanged** — existing
  subscriptions keep working.
- If you created a **new** Supabase project, update `SYNC_URL` in `index.html`
  (line ~202), redeploy, and re-add the calendar in Google Calendar
  (Other calendars → Add by URL).

### 3.2 Security notes (family app, read once)

- The edit mode password (`Clara`) is hardcoded in `index.html`. Anyone who views
  the page source can see it. Fine for a family calendar; upgrade to Supabase
  Auth (email login) if you ever need real protection.
- The `shifts` table allows anonymous writes (the SQL policy). Same trade-off:
  acceptable here because the UI is the only entry point. Revisit if the data
  becomes sensitive.
- The publishable key being visible in the page is **expected** and safe.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `curl` on the feed returns 401 | Function was deployed without `--no-verify-jwt`. Redeploy with the flag. |
| Feed returns 500 "Missing SUPABASE_URL..." | Redeploy the function — the CLI injects these env vars automatically on deploy. |
| "Table does not exist" in console | Run `create_table.sql` again in SQL Editor (1.2). |
| Calendar doesn't appear in Google Calendar | Wait a few hours, or delete and re-add the URL. Verify with `curl` first (1.3). |
| Blank white page | Open browser console: usually a CDN blocked or a JS error shown by the red error bar. |
| `supabase link` fails | Run `supabase login` first, then `supabase link --project-ref jbbguvtvmddxcklxeeeb`. |
| Changes to the site don't show up | With Netlify Drop, upload the folder again; with Git, check the deploy log in Netlify. |

## Quick command summary

```bash
# Supabase
supabase login
supabase link --project-ref jbbguvtvmddxcklxeeeb
supabase init                                  # only if supabase/config.toml is missing
supabase functions deploy shifts-ics --no-verify-jwt
curl -i https://jbbguvtvmddxcklxeeeb.supabase.co/functions/v1/shifts-ics

# Netlify (Option B only)
# create a new GitHub repo, then:
git init && git add . && git commit -m "Initial commit" && git branch -M main
git remote add origin https://github.com/<your-user>/<repo-name>.git
git push -u origin main
# then import the repo in Netlify with publish directory: .
```
