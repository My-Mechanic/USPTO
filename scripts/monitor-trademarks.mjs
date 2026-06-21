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
const ENDPOINT = (serial) => `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn${serial}/info.json`;

const nowISO = new Date().toISOString();

async function readWatchlist() {
  try {
    const raw = JSON.parse(await fs.readFile(WATCHLIST, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.serialNumbers || [];
    return [...new Set(arr.map((s) => String(s).replace(/[^0-9]/g, '')).filter(Boolean))];
  } catch {
    return [];
  }
}

function pick(obj, paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null && v !== '') return v;
  }
  return '';
}

function normalize(serial, j) {
  // TSDR shapes seen in the wild: { trademarks: [ { status, metadata } ] } or flat.
  const t = (j.trademarks && j.trademarks[0]) || j;
  const status = t.status || {};
  const meta = t.metadata || t.metaData || {};
  const out = {
    serialNumber: serial,
    markText: pick(t, ['status.markElement', 'metadata.markElement', 'markElement']) ||
      pick(status, ['markElement']) || pick(meta, ['markElement']) || '',
    owner: pick(t, ['status.currentOwner', 'metadata.partyName', 'metadata.ownerName']) ||
      pick(status, ['ownerName']) || '',
    status: pick(t, ['status.statusDefinitionText', 'status.tmStatusDescription', 'status.statusText', 'status.markCurrentStatusExternalDescriptionText']) ||
      pick(status, ['statusText']) || '',
    statusDate: pick(t, ['status.statusDate', 'status.markCurrentStatusDate']) || '',
    filingDate: pick(t, ['status.applicationDate', 'metadata.applicationDate', 'metadata.filingDate']) || '',
    registrationNumber: pick(t, ['status.usRegistrationNumber', 'metadata.registrationNumber']) || '',
    registrationDate: pick(t, ['status.registrationDate', 'metadata.registrationDate']) || '',
  };
  if (!out.status && !out.markText) out._note = 'Could not parse TSDR fields — adjust pick() paths in scripts/monitor-trademarks.mjs.';
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

async function main() {
  const serials = await readWatchlist();
  await fs.mkdir('frontend/public', { recursive: true });

  if (!KEY) {
    await write({ error: 'TSDR_API_KEY secret not set — add it in repo Settings → Secrets.', marks: serials.map((s) => ({ serialNumber: s, status: 'awaiting TSDR key', markText: '' })) });
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
  await write({ marks });
  console.log(`Wrote ${marks.length} trademark status record(s) to ${OUT}.`);
}

async function write(payload) {
  await fs.writeFile(OUT, JSON.stringify({ generatedAt: nowISO, ...payload }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
