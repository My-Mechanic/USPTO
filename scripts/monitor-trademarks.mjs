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
const ENDPOINT = (serial) => `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${serial}/info.json`;

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

async function fetchOne(serial) {
  const res = await fetch(ENDPOINT(serial), {
    headers: { 'USPTO-API-KEY': KEY, Accept: 'application/json' },
  });
  if (res.status === 404) return { serialNumber: serial, status: 'Not found', markText: '' };
  if (!res.ok) return { serialNumber: serial, status: `TSDR error ${res.status}`, markText: '' };
  const j = await res.json();
  return normalize(serial, j);
}

// Compare new marks against the previous run; return human-meaningful changes.
function diff(prev, marks) {
  const changes = [];
  for (const m of marks) {
    const before = prev.get(String(m.serialNumber));
    if (!before) continue; // first time we see it — not a "change"
    if (before.status && m.status && before.status !== m.status) {
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

  if (!KEY) {
    await write({ error: 'TSDR_API_KEY secret not set — add it in repo Settings → Secrets.', marks: serials.map((s) => ({ serialNumber: s, status: 'awaiting TSDR key', markText: '' })), changes: [] });
    await writeChangesMd([]);
    console.log('No TSDR_API_KEY; wrote placeholder status for', serials.length, 'serial(s).');
    return;
  }

  const marks = [];
  for (const s of serials) {
    try {
      marks.push(await fetchOne(s));
      console.log('checked', s);
    } catch (e) {
      marks.push({ serialNumber: s, status: `fetch failed: ${e.message}`, markText: '' });
    }
    // be polite to TSDR
    await new Promise((r) => setTimeout(r, 400));
  }
  const changes = diff(prev, marks);
  await write({ marks, changes });
  await appendHistory(changes);
  await writeChangesMd(changes);
  console.log(`Wrote ${marks.length} status record(s); ${changes.length} change(s) detected.`);
}

async function write(payload) {
  await fs.writeFile(OUT, JSON.stringify({ generatedAt: nowISO, ...payload }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
