// Playwright automation for USPTO Patent Center — private/pending applications.
//
// Design principles (per the project's security requirements):
//   • No credentials are scripted or stored. A VISIBLE browser opens and YOU sign
//     in (username + password + MFA) yourself.
//   • Headless is OFF and the real Chrome channel is preferred — Patent Center
//     blocks headless automation, and this is legitimate access to YOUR OWN
//     account, not evasion for a third party.
//   • Output stays local: ./output/private-applications.json (git-ignored).
//   • An optional session cookie is cached in ./.auth (git-ignored) so you don't
//     have to re-MFA every run. Delete that folder to fully sign out.
//
// IMPORTANT: Patent Center is a single-page app whose routes and DOM change over
// time. The selectors in waitForLogin() and scrapeWorkbench() are best-effort and
// marked CONFIRM/ADJUST — open the site, inspect the workbench table, and tune
// them. The login-wait and JSON output around them are stable.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const PATENT_CENTER = 'https://patentcenter.uspto.gov/';
const AUTH_DIR = path.join(ROOT, '.auth');
const STORAGE_STATE = path.join(AUTH_DIR, 'storage-state.json');
const OUTPUT_DIR = path.join(ROOT, 'output');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for you to complete MFA

export async function scrapePrivateApplications({ onStatus = () => {} } = {}) {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const launchOpts = { headless: false, args: ['--start-maximized'] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchOpts });
  } catch {
    onStatus('System Chrome not found — using bundled Chromium.');
    browser = await chromium.launch(launchOpts);
  }

  let storageState;
  try {
    await fs.access(STORAGE_STATE);
    storageState = STORAGE_STATE;
    onStatus('Reusing saved session (delete backend-automation/.auth to reset).');
  } catch {
    /* first run — no saved session */
  }

  const context = await browser.newContext({ viewport: null, storageState });
  const page = await context.newPage();

  try {
    onStatus('Opening USPTO Patent Center…');
    await page.goto(PATENT_CENTER, { waitUntil: 'domcontentloaded' });

    onStatus(
      'Sign in (username, password, MFA) in the browser window. Waiting up to 5 minutes…'
    );
    await waitForLogin(page);

    onStatus('Login detected. Saving session and reading your applications…');
    await context.storageState({ path: STORAGE_STATE });

    const patents = await scrapeWorkbench(page, onStatus);

    await fs.writeFile(
      path.join(OUTPUT_DIR, 'private-applications.json'),
      JSON.stringify(patents, null, 2)
    );
    await page
      .screenshot({ path: path.join(OUTPUT_DIR, 'workbench.png'), fullPage: true })
      .catch(() => {});

    onStatus(`Captured ${patents.length} application(s).`);
    return patents;
  } finally {
    await browser.close();
  }
}

// Wait until an authenticated-only control is visible. CONFIRM these selectors
// against the live UI — pick something that only exists once signed in.
async function waitForLogin(page) {
  const authedSelectors = [
    'text=/sign\\s*out/i',
    'text=/workbench/i',
    'a[href*="logout"]',
    '[aria-label*="account" i]',
  ];
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const sel of authedSelectors) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(
    'Timed out waiting for sign-in. Re-run and complete login within 5 minutes.'
  );
}

// Best-effort scrape of the signed-in user's application list. ADJUST selectors
// to match the current workbench table. Falls back to an empty list (plus a saved
// screenshot in ./output) so you can see what the page looked like.
async function scrapeWorkbench(page, onStatus) {
  onStatus('Reading your application workbench…');

  // If the workbench lives behind a nav link/route, try to reach it. Harmless if
  // it doesn't match.
  await page
    .getByRole('link', { name: /workbench|applications/i })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});

  try {
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
  } catch {
    onStatus('No application table found — see output/workbench.png to adjust selectors.');
    return [];
  }

  const rows = await page.locator('table tbody tr').all();
  const patents = [];
  for (const row of rows) {
    const cells = (await row.locator('td').allInnerTexts()).map((c) => c.trim());
    if (!cells.length || !cells[0]) continue;
    patents.push({
      // Column order is a guess — map these to the real columns after inspecting.
      applicationNumberText: cells[0],
      inventionTitle: cells[1] || '',
      filingDate: cells[2] || '',
      status: cells[3] || '',
      type: '',
      patentNumber: '',
      source: 'private',
      raw: cells,
    });
  }
  return patents;
}

// Allow running directly:  node scripts/patent-center.js
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  scrapePrivateApplications({ onStatus: (m) => console.log(m) })
    .then((p) => {
      console.log(
        `\nDone. Saved ${p.length} application(s) to output/private-applications.json`
      );
      process.exit(0);
    })
    .catch((e) => {
      console.error('\nError:', e.message);
      process.exit(1);
    });
}
