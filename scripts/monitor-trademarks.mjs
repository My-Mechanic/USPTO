// Trademark monitor — runs in GitHub Actions (Node 20, no dependencies).
//
// Reads data/trademark-watchlist.json (an array of serial numbers), queries the
// official USPTO TSDR API for each, and writes frontend/public/trademark-status.json
// which the site reads. The TSDR key is provided via the TSDR_API_KEY secret.
//
// Get a free TSDR key: https://account.uspto.gov/profile/api-manager
//
// NOTE: TSDR's info.json is a rich, nested document. The field paths below are
// best-effort across known shapes; if a field shows blank after the first real
// run, open the saved status JSON (it keeps `_note` when status couldn't be
// parsed) and adjust pick() paths here. The fetch/aggregate logic is stable.

import fs from 'node:fs/promises';

const KEY = process.env.TSDR_API_KEY || '';
const WATCHLIST = 'data/trademark-watchlist.json';
const OUT = 'frontend/public/trademark-status.json';
const HISTORY = 'data/trademark-history.json';
const CHANGES_MD = 'trademark-changes.md'; // consumed by the workflow to open an issue

// The keyed TSDR REST API (tsdrapi.uspto.gov/ts/cd/casestatus/*) was taken down in
// the June 2026 ODP migration and currently returns gateway stubs for every serial.
// The public status page is still served and contains the same data, so we parse
// that as the primary source — no API key required — and keep the keyed JSON API
// as a fallback for when USPTO restores it.
const STATUSVIEW = (s) => `https://tsdr.uspto.gov/statusview/sn${s}`;
const ENDPOINTS = [
  (s) => `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${s}/info.json`,
  (s) => `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${s}/info`,
];
const UA = 'Mozilla/5.0 (compatible; USPTO-Portfolio-Monitor/1.0; personal trademark status)';

// A "gateway stub" is the load-balancer's canned reply when the keyed TSDR backend
// is offline or the key isn't entitled to TSDR — not real data.
function looksLikeGatewayStub(text) {
  const t = (text || '').trim();
  return !t || t.startsWith('BACKEND RESPONSE STATUS') || t.startsWith('Default fixed response') || t.startsWith('<');
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
// "Jul. 26, 2017" / "May 08, 2018" -> "2017-07-26"
function parseDate(s) {
  const m = /([A-Za-z]{3})\.?\s+(\d{1,2}),\s+(\d{4})/.exec(s || '');
  if (!m || !MONTHS[m[1]]) return '';
  return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Flatten the server-rendered status page into clean text lines (label / value
// alternate), then read the value that follows an exact label line.
function htmlToLines(h) {
  const text = h
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
  return text.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function parseStatusView(serial, html) {
  const lines = htmlToLines(html);
  const after = (label) => { const i = lines.indexOf(label); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };
  const reg = after('US Registration Number:');
  // Prefer the standardized TM5 descriptor for `status` (stable across events);
  // keep the prose "Status:" line as statusDetail.
  const tm5 = after('TM5 Common Status Descriptor:');
  const sentence = after('Status:');
  return {
    serialNumber: serial,
    markText: after('Mark Literal Elements:') || after('Mark:') || '',
    owner: after('Owner Name:') || after('Holder Name:') || '',
    status: tm5 || sentence || '',
    statusDetail: sentence && sentence !== tm5 ? sentence : '',
    statusDate: parseDate(after('Status Date:')),
    filingDate: parseDate(after('Application Filing Date:')),
    registrationNumber: /^\d+$/.test(reg) ? reg : '',
    registrationDate: parseDate(after('Registration Date:')),
  };
}

const nowISO = new Date().toISOString();

// Read whatever we published last run, so we can diff status changes.
async function readPrevious() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    const map = new Map();
    for (const m of prev.marks || []) map.set(String(m.serialNumber), m);
    return map;
  } catch {
    return new Map();
  }
}

// Append detected changes to a small rolling history file (kept in the repo).
async function appendHistory(changes) {
  if (!changes.length) return;
  let hist = [];
  try { hist = JSON.parse(await fs.readFile(HISTORY, 'utf8')); } catch {}
  if (!Array.isArray(hist)) hist = [];
  for (const c of changes) hist.unshift({ at: nowISO, ...c });
  if (hist.length > 1000) hist.length = 1000;
  await fs.writeFile(HISTORY, JSON.stringify(hist, null, 2));
}

async function readWatchlist() {
  try {
    const raw = JSON.parse(await fs.readFile(WATCHLIST, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.serialNumbers || [];
    return [...new Set(arr.map((s) => String(s).replace(/[^0-9]/g, '')).filter(Boolean))];
  } catch {
    return [];
  }
}

// Most recent owner name from parties.ownerGroups (verified against TSDR info.json).
function ownerName(t) {
  const og = t.parties && t.parties.ownerGroups;
  if (!og) return '';
  const groups = Object.values(og);
  for (let i = groups.length - 1; i >= 0; i--) {
    const arr = groups[i];
    if (Array.isArray(arr) && arr.length) {
      const p = arr[arr.length - 1];
      if (p && p.name) return p.name;
    }
  }
  return '';
}

// Field paths verified against a live TSDR info.json response (serial 75554461).
function normalize(serial, j) {
  const t = (j.trademarks && j.trademarks[0]) || {};
  const s = t.status || {};
  const statusText =
    s.tm5StatusDesc || s.extStatusDesc || (s.status != null ? `Status code ${s.status}` : '');
  const out = {
    serialNumber: serial,
    markText: s.markElement || '',
    owner: ownerName(t),
    status: statusText,
    statusDate: s.statusDate || '',
    filingDate: s.filingDate || '',
    registrationNumber: s.usRegistrationNumber || '',
    registrationDate: s.usRegistrationDate || '',
  };
  if (!out.status && !out.markText)
    out._note = 'Could not parse TSDR fields — check scripts/monitor-trademarks.mjs.';
  return out;
}

// Resolve one serial. Returns { mark, unavailable } so the caller can tell
// "USPTO is down" apart from "this serial genuinely wasn't found".
async function fetchOne(serial) {
  // 1) Keyed JSON API first, *if* a key is set and the API is actually serving
  //    real JSON again (cleaner/structured). Skipped entirely when no key.
  if (KEY) {
    for (const build of ENDPOINTS) {
      try {
        const res = await fetch(build(serial), { headers: { 'USPTO-API-KEY': KEY, Accept: 'application/json' } });
        const body = await res.text();
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json') && !looksLikeGatewayStub(body)) {
          try { return { mark: normalize(serial, JSON.parse(body)) }; } catch { /* fall through to scrape */ }
        }
      } catch { /* try next / fall through to scrape */ }
    }
  }

  // 2) Public status page (no key needed) — the reliable source today.
  try {
    const res = await fetch(STATUSVIEW(serial), { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.ok) {
      const mark = parseStatusView(serial, await res.text());
      if (mark.markText || mark.status) return { mark };
    } else if (res.status === 404) {
      return { mark: { serialNumber: serial, status: 'Not found', markText: '' } };
    }
  } catch { /* fall through */ }

  return {
    unavailable: true,
    mark: { serialNumber: serial, status: 'TSDR temporarily unavailable', markText: '', _note: 'Both the TSDR status page and keyed API were unreachable. Will retry automatically.' },
  };
}

// Synthetic, non-USPTO statuses we write ourselves — never treat transitions
// involving these as a real status change worth emailing about.
const SYNTHETIC = /^(awaiting setup|awaiting TSDR key|TSDR temporarily unavailable|TSDR error|Not found|fetch failed)/i;
const isReal = (s) => s && !SYNTHETIC.test(s);

// Compare new marks against the previous run; return human-meaningful changes.
function diff(prev, marks) {
  const changes = [];
  for (const m of marks) {
    const before = prev.get(String(m.serialNumber));
    if (!before) continue; // first time we see it — not a "change"
    if (isReal(before.status) && isReal(m.status) && before.status !== m.status) {
      changes.push({ serialNumber: m.serialNumber, markText: m.markText || before.markText || '', field: 'status', from: before.status, to: m.status });
    }
    if (!before.registrationNumber && m.registrationNumber) {
      changes.push({ serialNumber: m.serialNumber, markText: m.markText || '', field: 'registration', from: '(pending)', to: m.registrationNumber });
    }
  }
  return changes;
}

async function writeChangesMd(changes) {
  if (!changes.length) {
    await fs.writeFile(CHANGES_MD, '');
    return;
  }
  const lines = [
    '### Trademark status updates',
    '',
    `${changes.length} change(s) detected on ${nowISO.slice(0, 10)}:`,
    '',
    ...changes.map((c) =>
      c.field === 'registration'
        ? `- **${c.markText || c.serialNumber}** (serial ${c.serialNumber}) — **registered** as #${c.to}.`
        : `- **${c.markText || c.serialNumber}** (serial ${c.serialNumber}): \`${c.from}\` → \`${c.to}\``
    ),
    '',
    '_Automated by the Monitor trademarks workflow. View details on the dashboard._',
  ];
  await fs.writeFile(CHANGES_MD, lines.join('\n'));
}

async function main() {
  const serials = await readWatchlist();
  await fs.mkdir('frontend/public', { recursive: true });
  const prev = await readPrevious();

  if (!serials.length) {
    await write({ marks: [], changes: [] });
    await writeChangesMd([]);
    console.log('Watchlist is empty — add serials to data/trademark-watchlist.json.');
    return;
  }

  // No key needed: the public status page is the primary source. A key only
  // enables the keyed JSON API fallback when USPTO restores it.
  const marks = [];
  let unavailable = 0;
  for (const s of serials) {
    try {
      const { mark, unavailable: u } = await fetchOne(s);
      if (u) unavailable++;
      marks.push(mark);
      console.log('checked', s, '→', mark.status || mark.markText || 'ok');
    } catch (e) {
      marks.push({ serialNumber: s, status: `fetch failed: ${e.message}`, markText: '' });
    }
    // be polite to TSDR
    await new Promise((r) => setTimeout(r, 400));
  }
  const changes = diff(prev, marks);
  // Surface a single, honest banner when the whole API is unreachable, rather
  // than silently showing every mark as broken.
  const info = unavailable === serials.length
    ? 'USPTO TSDR API is currently unreachable (June 2026 ODP migration), or this key is not subscribed to the TSDR product. Status will fill in automatically once it responds.'
    : '';
  await write({ marks, changes, ...(info ? { info } : {}) });
  await appendHistory(changes);
  await writeChangesMd(changes);
  console.log(`Wrote ${marks.length} status record(s); ${changes.length} change(s); ${unavailable} unavailable.`);
}

async function write(payload) {
  await fs.writeFile(OUT, JSON.stringify({ generatedAt: nowISO, ...payload }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
