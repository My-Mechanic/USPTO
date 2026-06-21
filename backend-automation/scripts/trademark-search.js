// Trademark owner search via the public USPTO Trademark Search site.
//
// Why a browser: USPTO exposes no free, official JSON API for owner-name trademark
// search (tmsearch.uspto.gov blocks direct API calls; TSDR/assignment APIs need
// separate keys and send no CORS headers). So — exactly like the patent-center
// flow — we drive the real public search UI with Playwright and read the results.
// No login is required; trademark search is public.
//
// IMPORTANT: tmsearch.uspto.gov is a single-page app whose DOM/routes change. The
// selectors below are best-effort and marked CONFIRM/ADJUST. A screenshot is
// saved to ./output/trademarks.png so you can map the real result rows. The
// navigation + JSON output around them are stable.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const TM_SEARCH = 'https://tmsearch.uspto.gov/search/search-information';

export async function searchTrademarks({ owner, onStatus = () => {} } = {}) {
  if (!owner) throw new Error('owner name is required');
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const launchOpts = { headless: false, args: ['--start-maximized'] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchOpts });
  } catch {
    onStatus('System Chrome not found — using bundled Chromium.');
    browser = await chromium.launch(launchOpts);
  }
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    onStatus(`Opening USPTO Trademark Search for "${owner}"…`);
    await page.goto(TM_SEARCH, { waitUntil: 'domcontentloaded' });

    // CONFIRM: the search box + an owner-field query. The site supports a query
    // syntax; "<owner>"[OW] targets the Owner Name field. Adjust the selector to
    // the live search input.
    const box = page
      .locator('input[type="search"], input[type="text"], textarea')
      .first();
    await box.waitFor({ timeout: 20000 });
    await box.fill(`"${owner}"[OW]`);
    await box.press('Enter');

    // CONFIRM: wait for the results region/table to render.
    await page
      .waitForSelector('table tbody tr, [role="row"], .results, app-search-results', {
        timeout: 20000,
      })
      .catch(() => {});
    await page.waitForTimeout(2500);

    const marks = await scrapeResults(page);

    await fs.writeFile(
      path.join(OUTPUT_DIR, 'trademarks.json'),
      JSON.stringify(marks, null, 2)
    );
    await page
      .screenshot({ path: path.join(OUTPUT_DIR, 'trademarks.png'), fullPage: true })
      .catch(() => {});

    if (!marks.length) {
      onStatus('No rows parsed — open output/trademarks.png and tune selectors.');
    } else {
      onStatus(`Captured ${marks.length} trademark(s).`);
    }
    return marks;
  } finally {
    await browser.close();
  }
}

// Best-effort row parse. ADJUST column mapping after inspecting the live results.
async function scrapeResults(page) {
  const rows = await page.locator('table tbody tr').all();
  const marks = [];
  for (const row of rows) {
    const cells = (await row.locator('td').allInnerTexts()).map((c) => c.trim());
    if (!cells.length) continue;
    // Heuristic: find a 7-8 digit serial number among the cells.
    const serial = (cells.find((c) => /^\d{7,8}$/.test(c.replace(/\D/g, ''))) || '')
      .replace(/\D/g, '');
    marks.push({
      serialNumber: serial || cells[0],
      markText: cells.find((c) => /[A-Za-z]/.test(c)) || '',
      status: cells.find((c) => /live|dead|registered|pending|abandoned/i.test(c)) || '',
      owner: '',
      filingDate: cells.find((c) => /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(c)) || '',
      registrationNumber: '',
      raw: cells,
    });
  }
  return marks;
}

// Allow: node scripts/trademark-search.js -- "OWNER NAME"
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const owner = process.argv.slice(2).join(' ').replace(/^--\s*/, '').trim();
  if (!owner) {
    console.error('Usage: npm run trademarks -- "OWNER NAME"');
    process.exit(1);
  }
  searchTrademarks({ owner, onStatus: (m) => console.log(m) })
    .then((m) => {
      console.log(`\nDone. Saved ${m.length} trademark(s) to output/trademarks.json`);
      process.exit(0);
    })
    .catch((e) => {
      console.error('\nError:', e.message);
      process.exit(1);
    });
}
