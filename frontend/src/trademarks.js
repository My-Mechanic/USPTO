// Trademark monitoring (read side).
//
// A scheduled GitHub Action (.github/workflows/monitor-trademarks.yml) reads the
// repo's data/trademark-watchlist.json, calls the official USPTO TSDR API with a
// secret key, and publishes frontend/public/trademark-status.json. This module
// just READS that published file and manages the local watchlist of serials the
// user wants to add (which they commit to the repo file to start monitoring).

const STATUS_URL = `${import.meta.env.BASE_URL}trademark-status.json`;

// Local list of serial numbers the user has added in the UI (to be committed to
// data/trademark-watchlist.json so the Action picks them up).
export const tmWatch = {
  list() {
    try { return JSON.parse(localStorage.getItem('tm_watch') || '[]'); } catch { return []; }
  },
  add(serial) {
    const s = String(serial).replace(/[^0-9]/g, '');
    if (!s) return;
    const l = tmWatch.list();
    if (!l.includes(s)) l.push(s);
    localStorage.setItem('tm_watch', JSON.stringify(l));
  },
  remove(serial) {
    localStorage.setItem('tm_watch', JSON.stringify(tmWatch.list().filter((x) => x !== serial)));
  },
  seed(serials) {
    const l = new Set(tmWatch.list());
    for (const s of serials) if (s) l.add(String(s));
    localStorage.setItem('tm_watch', JSON.stringify([...l]));
  },
};

// Returns { generatedAt, info, marks: [normalized] }. Empty if not generated yet.
// `info` is a neutral status note (e.g. setup pending, USPTO API down) — not an
// alarming "secret missing" error.
export async function loadTrademarkStatus() {
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!res.ok) return { marks: [] };
    const d = await res.json();
    const marks = (d.marks || []).map(normalizeTrademark);
    // Keep the local watchlist in sync with what's actually monitored.
    tmWatch.seed(marks.map((m) => m.serialNumber));
    return { generatedAt: d.generatedAt || '', info: d.info || d.error || '', marks };
  } catch {
    return { marks: [] };
  }
}

/* ---------- instant in-browser fetch ---------- */
// Local cache of marks fetched live (so they show immediately and persist
// between the daily Action syncs).
export const tmLive = {
  all() { try { return JSON.parse(localStorage.getItem('tm_live') || '{}'); } catch { return {}; } },
  get(serial) { return tmLive.all()[String(serial)] || null; },
  set(mark) {
    if (!mark || !mark.serialNumber) return;
    const all = tmLive.all();
    all[String(mark.serialNumber)] = { ...mark, fetchedAt: new Date().toISOString() };
    localStorage.setItem('tm_live', JSON.stringify(all));
  },
};

// Optional self-hosted proxy (a Cloudflare Worker — see workers/tsdr-proxy.js).
// Set it in the UI; falls back to a build-time VITE_TM_PROXY. When present we get
// clean JSON instantly and reliably. Without it we try public CORS proxies.
export const tmProxy = {
  get() { return localStorage.getItem('tm_proxy') || import.meta.env.VITE_TM_PROXY || ''; },
  set(url) { localStorage.setItem('tm_proxy', (url || '').trim().replace(/\/+$/, '')); },
};

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function parseDate(s) {
  const m = /([A-Za-z]{3})\.?\s+(\d{1,2}),\s+(\d{4})/.exec(s || '');
  if (!m || !MONTHS[m[1]]) return '';
  return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
function htmlToLines(h) {
  return h
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function parseStatusView(serial, html) {
  const lines = htmlToLines(html);
  const after = (label) => { const i = lines.indexOf(label); return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''; };
  const reg = after('US Registration Number:');
  return {
    serialNumber: serial,
    markText: after('Mark Literal Elements:') || after('Mark:') || '',
    owner: after('Owner Name:') || after('Holder Name:') || '',
    status: after('Status:') || after('TM5 Common Status Descriptor:') || '',
    statusDate: parseDate(after('Status Date:')),
    filingDate: parseDate(after('Application Filing Date:')),
    registrationNumber: /^\d+$/.test(reg) ? reg : '',
    registrationDate: parseDate(after('Registration Date:')),
  };
}

const STATUSVIEW = (s) => `https://tsdr.uspto.gov/statusview/sn${s}`;
// Public CORS proxies used only when no self-hosted proxy is configured.
// Each returns { wrap } telling us how to read the response.
const PUBLIC_PROXIES = [
  { url: (t) => `https://api.allorigins.win/get?url=${encodeURIComponent(t)}`, wrap: 'allorigins' },
  { url: (t) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(t)}`, wrap: 'raw' },
  { url: (t) => `https://corsproxy.io/?url=${encodeURIComponent(t)}`, wrap: 'raw' },
];

// Fetch + parse a single trademark live, in the browser. Returns a normalized
// mark, or throws. Tries the self-hosted proxy first (clean JSON), then public
// proxies (HTML we parse here).
export async function fetchTrademarkLive(serial) {
  const sn = String(serial).replace(/[^0-9]/g, '');
  if (!sn) throw new Error('Enter a valid serial number.');

  // 1) Self-hosted Worker → clean JSON, instant + reliable.
  const proxy = tmProxy.get();
  if (proxy) {
    const res = await fetch(`${proxy}?sn=${sn}`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const j = await res.json();
      if (j && (j.markText || j.status) && !j.error) return normalizeTrademark(j);
      if (j && j.error) throw new Error(j.error);
    }
  }

  // 2) Public proxies (best effort). Try each until one returns the page.
  const target = STATUSVIEW(sn);
  let lastErr = '';
  for (const p of PUBLIC_PROXIES) {
    try {
      const res = await fetch(p.url(target), { headers: { Accept: 'text/html,application/json' } });
      if (!res.ok) { lastErr = `proxy ${res.status}`; continue; }
      let html;
      if (p.wrap === 'allorigins') {
        const j = await res.json();
        html = j && j.contents;
      } else {
        html = await res.text();
      }
      if (!html || !/statusview|Mark Literal|US Serial Number/i.test(html)) { lastErr = 'empty'; continue; }
      const mark = parseStatusView(sn, html);
      if (mark.markText || mark.status) return normalizeTrademark(mark);
      lastErr = 'unparsed';
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(
    `Couldn't fetch live right now (${lastErr || 'all proxies failed'}). ` +
      'For instant, reliable lookups, deploy the included Cloudflare Worker and set it as your Live-fetch proxy. ' +
      'Otherwise it will appear after the next daily sync.'
  );
}

export function normalizeTrademark(t) {
  const serial = String(t.serialNumber || t.serial || '').replace(/[^0-9]/g, '');
  return {
    serialNumber: serial,
    registrationNumber: t.registrationNumber || '',
    markText: t.markText || t.mark || '(no word mark)',
    owner: t.owner || t.ownerName || '',
    status: t.status || t.statusText || '',
    statusDate: t.statusDate || '',
    filingDate: t.filingDate || '',
    registrationDate: t.registrationDate || '',
    link: serial
      ? `https://tsdr.uspto.gov/#caseNumber=${serial}&caseType=SERIAL_NO&searchType=statusSearch`
      : '',
    source: 'trademark',
  };
}
