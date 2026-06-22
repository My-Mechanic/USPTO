// OPT-IN patent monitor — runs in GitHub Actions (Node 20, no dependencies).
//
// Unlike the live in-browser check, this watches your patents server-side every
// day and opens an issue (→ email) when a status or prosecution event changes —
// so you hear about office actions even when the site isn't open.
//
// TRADE-OFF: this requires your USPTO ODP API key as the ODP_API_KEY repo secret.
// That is a deliberate departure from the "key only in your browser" default, so
// the whole workflow is disabled unless BOTH data/patent-watchlist.json exists and
// the secret is set. If you prefer key-in-browser-only, don't create either.
//
// Watchlist format: data/patent-watchlist.json = ["18000000", "17999999", ...]
// (an array of application numbers). Export it from the dashboard.

import fs from 'node:fs/promises';

const KEY = process.env.ODP_API_KEY || '';
const WATCHLIST = 'data/patent-watchlist.json';
const OUT = 'frontend/public/patent-status.json';
const HISTORY = 'data/patent-history.json';
const CHANGES_MD = 'patent-changes.md';
const BASE = 'https://api.uspto.gov';

const nowISO = new Date().toISOString();
const digits = (s) => String(s).replace(/[^0-9]/g, '');

async function readWatchlist() {
  try {
    const raw = JSON.parse(await fs.readFile(WATCHLIST, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.applicationNumbers || raw.patents || [];
    return [...new Set(arr.map((s) => digits(typeof s === 'string' ? s : s.applicationNumberText || '')).filter(Boolean))];
  } catch {
    return null; // null => watchlist absent (feature not opted in)
  }
}

async function readPrevious() {
  try {
    const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
    const map = new Map();
    for (const p of prev.patents || []) map.set(String(p.applicationNumberText), p);
    return map;
  } catch {
    return new Map();
  }
}

function normalize(entry) {
  const m = entry.applicationMetaData || {};
  const events = Array.isArray(entry.eventDataBag) ? entry.eventDataBag : [];
  let latest = null;
  for (const e of events) if (!latest || (e.eventDate || '') > (latest.eventDate || '')) latest = e;
  return {
    applicationNumberText: entry.applicationNumberText || m.applicationNumberText || '',
    inventionTitle: m.inventionTitle || '',
    status: m.applicationStatusDescriptionText || '',
    statusDate: m.applicationStatusDate || '',
    patentNumber: m.patentNumber || '',
    latestEvent: latest ? latest.eventDescriptionText || '' : '',
    latestEventDate: latest ? latest.eventDate || '' : '',
  };
}

function snapshot(p) {
  return [p.status, p.statusDate, p.latestEvent, p.latestEventDate].join(' | ');
}

async function fetchOne(n) {
  const res = await fetch(`${BASE}/api/v1/patent/applications/${n}`, {
    headers: { 'X-API-Key': KEY, Accept: 'application/json' },
  });
  if (res.status === 404) return { applicationNumberText: n, status: 'Not found' };
  if (!res.ok) return { applicationNumberText: n, status: `ODP error ${res.status}` };
  const j = await res.json();
  const entry = j && (j.patentFileWrapperDataBag || [])[0];
  return entry ? normalize(entry) : { applicationNumberText: n, status: 'No data' };
}

function diff(prev, patents) {
  const changes = [];
  for (const p of patents) {
    const before = prev.get(String(p.applicationNumberText));
    if (!before) continue;
    if (snapshot(before) !== snapshot(p)) {
      changes.push({
        applicationNumberText: p.applicationNumberText,
        inventionTitle: p.inventionTitle || before.inventionTitle || '',
        from: before.status, to: p.status,
        event: p.latestEvent, eventDate: p.latestEventDate,
      });
    }
  }
  return changes;
}

async function appendHistory(changes) {
  if (!changes.length) return;
  let hist = [];
  try { hist = JSON.parse(await fs.readFile(HISTORY, 'utf8')); } catch {}
  if (!Array.isArray(hist)) hist = [];
  for (const c of changes) hist.unshift({ at: nowISO, ...c });
  if (hist.length > 1000) hist.length = 1000;
  await fs.writeFile(HISTORY, JSON.stringify(hist, null, 2));
}

async function writeChangesMd(changes) {
  if (!changes.length) { await fs.writeFile(CHANGES_MD, ''); return; }
  const lines = [
    '### Patent status updates',
    '',
    `${changes.length} change(s) detected on ${nowISO.slice(0, 10)}:`,
    '',
    ...changes.map((c) =>
      `- **${c.inventionTitle || c.applicationNumberText}** (app ${c.applicationNumberText}): \`${c.from || '—'}\` → \`${c.to || '—'}\`` +
      (c.event ? ` · latest: ${c.event}${c.eventDate ? ` (${c.eventDate})` : ''}` : '')
    ),
    '',
    '_Automated by the Monitor patents workflow._',
  ];
  await fs.writeFile(CHANGES_MD, lines.join('\n'));
}

async function main() {
  const serials = await readWatchlist();
  if (!serials) {
    console.log(`No ${WATCHLIST} — patent monitoring not opted in. Nothing to do.`);
    await writeChangesMd([]);
    return;
  }
  if (!KEY) {
    console.log('ODP_API_KEY secret not set — skipping (add it to opt in to patent email alerts).');
    await writeChangesMd([]);
    return;
  }
  await fs.mkdir('frontend/public', { recursive: true });
  const prev = await readPrevious();

  const patents = [];
  for (const n of serials) {
    try { patents.push(await fetchOne(n)); console.log('checked', n); }
    catch (e) { patents.push({ applicationNumberText: n, status: `fetch failed: ${e.message}` }); }
    await new Promise((r) => setTimeout(r, 400));
  }
  const changes = diff(prev, patents);
  await fs.writeFile(OUT, JSON.stringify({ generatedAt: nowISO, patents, changes }, null, 2));
  await appendHistory(changes);
  await writeChangesMd(changes);
  console.log(`Wrote ${patents.length} patent record(s); ${changes.length} change(s) detected.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
