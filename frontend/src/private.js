// Private / unpublished applications — fetched "from the site" via a bookmarklet.
//
// Unpublished applications are confidential: only authenticated Patent Center can
// see them, and Patent Center sends no CORS headers + isolates its login session,
// so a static page CANNOT fetch them directly. The workaround that needs no local
// server: a bookmarklet that runs INSIDE your signed-in patentcenter.uspto.gov tab
// (same-origin → uses your own session), scrapes your application list, and opens
// this app with the data in the URL fragment. No credentials are ever sent to us.
//
// This module: (1) generates that bookmarklet, and (2) on load, imports any data a
// bookmarklet handed back via the `#imp=` fragment.

const HASH_KEY = 'imp=';

// Read + clear a private-import payload from the URL fragment. Returns records.
export function consumePrivateImport() {
  try {
    const h = location.hash || '';
    const i = h.indexOf(HASH_KEY);
    if (i < 0) return [];
    const b64 = decodeURIComponent(h.slice(i + HASH_KEY.length));
    history.replaceState(null, '', location.pathname + location.search); // don't re-import on refresh
    return parsePrivatePayload(atobUtf8(b64));
  } catch {
    return [];
  }
}

// Parse a JSON array of records (also used by the manual paste fallback).
export function parsePrivatePayload(json) {
  const arr = JSON.parse(json);
  const list = Array.isArray(arr) ? arr : arr.patents || [];
  return list
    .filter((p) => p && p.applicationNumberText)
    .map((p) => ({
      // Keep the ID as-is (trimmed) so PCT/lettered numbers survive; the DB layer
      // canonicalizes for the key.
      applicationNumberText: String(p.applicationNumberText).trim(),
      inventionTitle: p.inventionTitle || '',
      filingDate: p.filingDate || '',
      status: p.status || '',
      type: p.type || '',
      patentNumber: p.patentNumber || '',
      source: 'private',
    }))
    .filter((p) => p.applicationNumberText);
}

function atobUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/* ---------- Patent Center "Applications by Customer" XML import ---------- */
// Patent Center can export your full application list as XML (a <PairCustomerList>
// of <PairCustomer> entries). This is the most reliable private-data path: download
// it while signed in, then upload it here — parsed entirely in your browser.

function xmlDecode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const dateOnly = (s) => xmlDecode(s).trim().split('T')[0] || '';
function tagVal(chunk, tag) {
  const m = chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? xmlDecode(m[1]).trim() : '';
}

// Parse the XML text into normalized private patent records.
export function parsePatentCenterXml(xml) {
  if (!/<PairCustomer[>\s]/i.test(xml)) {
    throw new Error('Not a Patent Center "Applications by Customer" XML export.');
  }
  const chunks = xml.split(/<PairCustomer>/i).slice(1);
  const out = [];
  for (const raw of chunks) {
    const chunk = raw.split(/<\/PairCustomer>/i)[0];
    const applId = tagVal(chunk, 'applId');
    if (!applId) continue;
    const docket = tagVal(chunk, 'attyDktNo');
    const patentNo = tagVal(chunk, 'patentNo');
    out.push({
      applicationNumberText: applId,
      // The export has no invention title; use the attorney docket as a label.
      inventionTitle: docket || '',
      docketNumber: docket,
      filingDate: dateOnly(tagVal(chunk, 'fileDt')),
      status: tagVal(chunk, 'applicationStatusText'),
      statusDate: dateOnly(tagVal(chunk, 'statusDate')),
      patentNumber: /\d/.test(patentNo) ? patentNo.replace(/[^0-9]/g, '') : '',
      grantDate: dateOnly(tagVal(chunk, 'patentIssueDt')),
      publicationNumber: tagVal(chunk, 'earliestPublicationNumber'),
      latestEvent: tagVal(chunk, 'lastTransactionDescription'),
      latestEventDate: dateOnly(tagVal(chunk, 'LastTransactionDate')),
      examiner: tagVal(chunk, 'examinerName'),
      groupArtUnit: tagVal(chunk, 'groupArtUnit'),
      customerNumber: tagVal(chunk, 'customerNo'),
      source: 'private',
    });
  }
  if (!out.length) throw new Error('No applications found in the XML.');
  return out;
}

// The function literally executed on patentcenter.uspto.gov. It must be fully
// self-contained (no closure refs except the injected SITE arg) because it is
// serialized via toString() into the bookmarklet.
function patentCenterExtractor(SITE) {
  var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
  var numRe = /\b(\d{2}\/\d{3},?\d{3}|\d{7,8})\b/;
  var dateRe = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Z][a-z]{2}\.?\s+\d{1,2},\s*\d{4})\b/;
  var apps = [], seen = {};
  var push = function (num, title, filing, status, raw) {
    var n = (num || '').replace(/[^0-9]/g, '');
    if (n.length < 7 || seen[n]) return;
    seen[n] = 1;
    apps.push({ applicationNumberText: n, inventionTitle: title || '', filingDate: filing || '', status: status || '', source: 'private', raw: raw });
  };
  // Prefer real table rows (the Workbench grid).
  var rows = document.querySelectorAll('table tbody tr, [role="row"]');
  for (var i = 0; i < rows.length; i++) {
    var cells = [].slice.call(rows[i].querySelectorAll('td,[role="cell"],[role="gridcell"]')).map(function (c) { return clean(c.innerText); });
    if (!cells.length) continue;
    var joined = cells.join('  ');
    var m = joined.match(numRe);
    if (!m) continue;
    var title = cells.find(function (c) { return c.length > 8 && !numRe.test(c) && !dateRe.test(c); }) || '';
    var d = joined.match(dateRe);
    push(m[1], title, d ? d[0] : '', '', cells);
  }
  // Fallback: scan the whole page for application-number patterns.
  if (!apps.length) {
    var text = document.body.innerText || '';
    var re = /\b(\d{2}\/\d{3},?\d{3})\b/g, mm;
    while ((mm = re.exec(text))) push(mm[1], '', '', '');
  }
  if (!apps.length) {
    alert('No applications found here. Open your Patent Center WORKBENCH (your list of applications) while signed in, then click this bookmarklet again.');
    return;
  }
  var json = JSON.stringify(apps);
  try { if (navigator.clipboard) navigator.clipboard.writeText(json); } catch (e) {}
  var b64 = btoa(unescape(encodeURIComponent(json)));
  // Hand off to the app. Fragment keeps the data out of server logs/history nav.
  window.open(SITE + '#imp=' + encodeURIComponent(b64), '_blank');
}

// Build the `javascript:` bookmarklet string for the given app URL.
export function bookmarkletSource(siteUrl) {
  return `javascript:(${patentCenterExtractor.toString()})(${JSON.stringify(siteUrl)});void 0;`;
}

// The app's own URL (origin + Vite base), used as the bookmarklet's hand-off target.
export function appUrl() {
  return location.origin + (import.meta.env.BASE_URL || '/');
}
