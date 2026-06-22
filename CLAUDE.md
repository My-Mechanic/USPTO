# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal monitor for **your own** patents and trademarks (not a search engine for
others' IP). Static SPA on GitHub Pages + scheduled GitHub Actions. **No server, by
design** — your ODP API key and patents live only in your browser (localStorage /
IndexedDB); trademark *status* (public data) is published by an Action.

## Commands

```bash
cd frontend && npm install
npm run dev      # local dev server (http://localhost:5173/USPTO/)
npm run build    # production build into frontend/dist (VITE_BASE=/USPTO/ in CI)
npm run preview  # serve the built site

# Monitors (run by GitHub Actions; runnable locally with the env var set)
TSDR_API_KEY=… node scripts/monitor-trademarks.mjs   # → frontend/public/trademark-status.json
ODP_API_KEY=…  node scripts/monitor-patents.mjs       # opt-in; → frontend/public/patent-status.json
```
No test suite yet. `node --check <file>` to syntax-check the dependency-free monitor scripts.

## Architecture (the parts that span files)

- **frontend/src/** — vanilla-JS ES modules, no framework. `main.js` is the controller
  wiring three tabs (Dashboard / Patents / Trademarks). Rendering is in `ui.js` +
  `dashboard.js` (strictly text-node/DOM, never innerHTML — XSS-safe). Data:
  `api.js` (ODP patent client), `db.js` (IndexedDB patent store + key in localStorage),
  `trademarks.js` (reads the Action-published status JSON + local serial watchlist).
- **Derived features** — `deadlines.js` computes statutory deadlines (patent maintenance
  fees at 3.5/7.5/11.5yr from grant; trademark §8/§9/§15 from registration) from data we
  already store; `notify.js` does Web Notifications + a localStorage activity log + auto-check
  prefs; `ics.js` exports those deadlines to a calendar.
- **Two notification paths**, both shaped by the no-server constraint: (1) in-browser
  desktop alerts fired by `notify.js` when an open tab auto-checks; (2) background email via
  GitHub Actions — `scripts/monitor-*.mjs` diff against the previously published status JSON,
  write a `*-changes.md`, and the workflow opens an issue (GitHub emails the owner). The patent
  monitor is **opt-in** (needs `data/patent-watchlist.json` + `ODP_API_KEY` secret) because it
  departs from key-in-browser-only; it no-ops if either is absent.
- **backend-automation/** is LOCAL ONLY (Playwright sign-in for private/pending Patent Center
  data) and never deployed.

When base path or repo name changes, keep `frontend/vite.config.js` `base` and the workflows'
`VITE_BASE` in sync.

## Git Guidelines
- Every time you successfully complete a file modification or feature request, you must automatically run 'git add .', generate a concise commit message, run 'git commit', and immediately run 'git push origin main' to sync it online.

