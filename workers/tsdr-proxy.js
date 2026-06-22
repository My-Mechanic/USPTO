// Cloudflare Worker — instant, reliable trademark status for the browser.
//
// WHY THIS EXISTS
// USPTO's TSDR site (tsdr.uspto.gov) sends no CORS header, so a static page on
// GitHub Pages cannot fetch it directly, and public CORS proxies are rate-limited
// and flaky. This tiny Worker runs server-side (no CORS limits), fetches the
// public status page, parses it, and returns clean JSON with `Access-Control-
// Allow-Origin: *` — so the app can show a trademark the instant a serial is
// entered, without waiting for the daily GitHub Action.
//
// DEPLOY (free, ~3 minutes)
//   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
//   2. Paste this file, Deploy. Copy the URL (e.g. https://tsdr.<you>.workers.dev).
//   3. In the app's "My Trademarks" tab, paste that URL into "Live-fetch proxy".
//      (Or build with VITE_TM_PROXY set to it.)
//   Local dev alternative: `npx wrangler dev workers/tsdr-proxy.js`.
//
// Usage: GET https://your-worker/?sn=87544318  ->  { serialNumber, markText, ... }

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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const serial = (url.searchParams.get('sn') || '').replace(/[^0-9]/g, '');
    if (!/^\d{6,8}$/.test(serial)) return json({ error: 'Provide ?sn=<6-8 digit serial>' }, 400);

    try {
      const res = await fetch(`https://tsdr.uspto.gov/statusview/sn${serial}`, {
        headers: { 'User-Agent': 'USPTO-Portfolio-Monitor/1.0', Accept: 'text/html' },
      });
      if (res.status === 404) return json({ serialNumber: serial, status: 'Not found', markText: '' });
      if (!res.ok) return json({ serialNumber: serial, error: `TSDR ${res.status}` }, 502);
      const mark = parseStatusView(serial, await res.text());
      if (!mark.markText && !mark.status) return json({ serialNumber: serial, error: 'Could not parse TSDR status page' }, 502);
      return json(mark);
    } catch (e) {
      return json({ serialNumber: serial, error: String(e) }, 502);
    }
  },
};
