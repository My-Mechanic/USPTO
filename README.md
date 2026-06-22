# My USPTO Portfolio

A personal monitor for **your own** patents and trademarks. Add them to a
watchlist by number and the app tracks their status and flags updates — it is
**not** a search engine for other people's IP.

- **Patents** — add by application or patent number; status + prosecution events
  come live from the [USPTO Open Data Portal API](https://data.uspto.gov/) **in
  your browser**. "Check all for updates" re-fetches and highlights anything that
  changed since last time. Works on the live site, no server.
- **Private / pending** — pulled **locally** from Patent Center via a browser you
  sign into yourself (MFA). Nothing scripted or stored on a server.
- **Trademarks** — add serial numbers to a watchlist; a scheduled **GitHub Action**
  calls the official **USPTO TSDR API** with your free key and republishes the site
  with fresh status. Fully automatic, no server.

> **Privacy by design:** your API key and tracked patents live only in your browser
> (`localStorage` / `IndexedDB`). Trademark *status* (public data) is published by
> the Action. No credentials or private patent data touch any server or this repo.

## What it does for inventors

- **Status-change alerts.** Desktop/browser notifications fire when a tracked patent or
  trademark changes status while the site is open (it can **auto-check** on a schedule).
  Every change is also kept in a persistent **activity log**.
- **Deadline tracker — the one that saves your IP.** Auto-computes the dates you can't
  miss: patent **maintenance fees** (3.5 / 7.5 / 11.5 years after grant) and trademark
  **§8 / §9 / §15** post-registration deadlines. The **Dashboard** flags anything due soon,
  in its grace period, or lapsed.
- **Add to your calendar.** Export all deadlines as a `.ics` file (with 30-day reminders)
  for Google / Apple / Outlook Calendar.
- **Background email alerts.** The daily trademark Action opens a GitHub issue when status
  changes — GitHub emails you, no extra setup. An **opt-in** patent monitor does the same for
  patents (export `patent-watchlist.json`, commit it, add the `ODP_API_KEY` secret).
- **Portfolio dashboard** with counts (granted vs pending, registered vs pending), upcoming
  deadlines, and recent activity.
- **Notes & tags** per patent, a **prosecution-history timeline**, and **CSV/JSON export** of
  your whole portfolio.
- **Installable PWA.** Add it to your phone/desktop home screen; works offline (shows
  last-known data).

## Telling same-name inventors apart

Don't know your application number? **Find your patent (search to add)** combines
inventor first+last name, assignee/company, title keyword, and filing-date range
into one precise query — turning ~9,000 "John Smith" hits into a short list — then
you click **+ Add** on yours. Each result shows assignee, inventors, and inventor
location so namesakes are easy to distinguish.

---

## How trademark monitoring works

**No API key or secret is required.** USPTO decommissioned the keyed TSDR REST API
in its June 2026 ODP migration, so the monitor reads the public TSDR **status page**
(`tsdr.uspto.gov/statusview/sn<serial>`) and parses it. (If USPTO restores the keyed
JSON API, set `TSDR_API_KEY` and it's used automatically as the cleaner source.)

**Instant lookups (in the browser).** On the **My Trademarks** tab, type a serial and
click **Add & fetch** — status appears immediately, no waiting for a sync. Because
USPTO's site sends no CORS header, the browser fetches through a proxy:

- *Recommended:* deploy the free **Cloudflare Worker** in `workers/tsdr-proxy.js`
  (≈3 min, instructions in the file) and paste its URL into **Live-fetch proxy** on
  the trademark tab. Fast and reliable.
- *Out of the box:* leave it blank and the app uses best-effort public CORS proxies.

**Daily monitoring + alerts (optional).** To get change notifications and keep status
fresh server-side: **Download watchlist.json** and commit it to
`data/trademark-watchlist.json`. The **Monitor trademarks** Action then runs on that
commit, **daily**, and on demand — it re-fetches status, opens an issue (emails you)
on any change, and redeploys.

> The patent watchlist also needs no setup — add a number and click **Check for
> updates** anytime.

---

## Private / pending applications (unpublished)

Unpublished applications are confidential — only your authenticated Patent Center
session can see them, and Patent Center sends no CORS headers and isolates its login,
so **no website (including this one) can fetch them directly**. Three ways to bring
them in, none of which expose your credentials to this site:

1. **Upload a Patent Center XML export (most reliable).** In Patent Center →
   **Workbench → Applications by Customer Number**, download the XML, then on the
   **My Patents** tab open *"Import my private / pending applications"* → **Choose XML
   file**. It's parsed entirely in your browser (handles US, provisional, PCT, and
   reexam numbers) and the applications land in My Patents.
2. **Bookmarklet (no download).** Drag the **My Private Patents** button to your
   bookmarks bar; sign in to Patent Center, open your **Workbench**, and click it — it
   runs inside your own Patent Center tab (using your session), reads your application
   list, and opens this app with the data imported (also copied to your clipboard as a
   paste fallback). Your login never touches this site; only the resulting list does.
3. **Local bridge.** Run the app locally (`npm run dev` + `backend-automation`); the
   **Sync private / pending** button opens a real browser for you to sign in via MFA.
4. **Import JSON.** Capture the list any way you like and use **Import JSON**.

---

## Repository layout

```
USPTO/
├── frontend/                 # Vite + vanilla-JS SPA (deployed to GitHub Pages)
│   ├── index.html
│   ├── vite.config.js        # base: '/USPTO/'  (must match repo name)
│   └── src/{main,api,db,sync,ui}.js, styles.css
├── backend-automation/       # LOCAL ONLY — never deployed
│   ├── server.js             # 127.0.0.1 bridge the "Sync Now" button calls
│   ├── scripts/patent-center.js   # Playwright sign-in + scrape
│   └── playwright.config.js
└── .github/workflows/deploy.yml   # builds + deploys frontend on push to main
```

---

## Prerequisites

- **Node.js 18+** (20 recommended) and npm
- A **USPTO.gov account** with an **ODP API key** (free) for public data
- Google **Chrome** installed (recommended) for the private-data automation

### Get a USPTO ODP API key

1. Go to **https://data.uspto.gov/myodp** and sign in / create a USPTO.gov account.
2. Verify your identity (ID.me) and link it.
3. On the **Getting Started** page, **request an API key** and copy it.
   (Keys unused for 90 days are deleted.)

You'll paste this key into the app — it is stored only in your browser.

---

## Run it locally

### 1. Frontend (public patents)

```bash
cd frontend
npm install
npm run dev
```

Open the printed URL (e.g. `http://localhost:5173/USPTO/`).

1. Paste your **ODP API key** → **Save key**.
2. Type an inventor/applicant name → **Fetch public patents**.
   (Or use **Advanced → raw ODP query** for precise queries.)
3. Use the filter box, status filter, and sort dropdown to explore.

> If a field shows blank, the ODP response field name may have changed — adjust
> `normalizePatent()` in `frontend/src/api.js` against the live API.

### 2. Backend automation (private / pending patents)

In a **second terminal**:

```bash
cd backend-automation
npm install          # also downloads a browser via "playwright install"
npm run server       # starts the local bridge on http://127.0.0.1:8787
```

Now back in the **local** frontend, click **Sync Now**:

1. A real Chrome window opens at Patent Center.
2. **You** sign in — username, password, and MFA. (Up to 5 minutes.)
3. Once signed in, the script reads your application workbench and returns the
   list to the dashboard, which stores it in your browser under **Private /
   Pending**. A copy is also saved to `backend-automation/output/` (git-ignored).

You can also run the scraper standalone, without the frontend:

```bash
cd backend-automation
npm run scrape       # writes output/private-applications.json
```

Then load that file anywhere (including the public site) via **Import JSON**.

> **Selectors need tuning.** Patent Center is a SPA whose DOM changes over time.
> `scripts/patent-center.js` marks the workbench/login selectors with
> `CONFIRM/ADJUST`. Open the site, inspect the applications table, and map the
> columns. A screenshot is saved to `output/workbench.png` to help.

---

## Deploy the frontend to GitHub Pages

The repo already includes `.github/workflows/deploy.yml`, which builds
`frontend/` and deploys it on every push to `main`.

1. **Push to GitHub** (this repo's remote is `My-Mechanic/USPTO`):
   ```bash
   git add .
   git commit -m "Add USPTO patent dashboard"
   git push origin main
   ```
2. In GitHub: **Settings → Pages → Build and deployment → Source = GitHub Actions.**
3. The **Deploy frontend to GitHub Pages** workflow runs (watch the **Actions**
   tab). When it's green, your site is live at:
   ```
   https://my-mechanic.github.io/USPTO/
   ```

> If your repo name or owner differs, update `base` in `frontend/vite.config.js`
> **and** the `VITE_BASE` value in `deploy.yml` to `/<your-repo-name>/`.

On the public site, use **Import JSON** to view private data you captured locally.

---

## Security & legal notes

- **No secrets in the repo.** `.env` files and the `.auth/` / `output/` folders
  are git-ignored. The API key is entered at runtime, never built into the site.
- **You access only your own account.** The automation simply opens a browser for
  *you* to log into; it does not bypass MFA or impersonate anyone.
- **Respect the USPTO Terms of Use.** Automated access to Patent Center should be
  limited to your own data and reasonable rates. The ODP API has rate limits
  (HTTP 429) — the app surfaces these.
- **XSS-safe rendering.** All patent fields are inserted as text nodes / escaped,
  never as raw HTML.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401/403` on fetch | Bad/expired API key — re-copy from MyODP. |
| `429` on fetch | Rate limited — wait and retry. |
| Network/CORS error to `api.uspto.gov` | Check connectivity; confirm the key works in the ODP Swagger UI. |
| "Sync Now" says bridge unreachable | Start it: `cd backend-automation && npm run server`. |
| "Sync Now" disabled on the live site | Expected — use **Import JSON** there, or run the app locally. |
| Private list empty after login | Workbench selectors need tuning; see `output/workbench.png` and adjust `scripts/patent-center.js`. |
| Pages 404 / blank | `base` in `vite.config.js` must equal `/<repo-name>/`; set Pages source to **GitHub Actions**. |
