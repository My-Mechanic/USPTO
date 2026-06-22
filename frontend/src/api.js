// USPTO Open Data Portal (ODP) patent API client.
// Verified live: base https://api.uspto.gov, header X-API-Key, CORS: * .
//   • GET /api/v1/patent/applications/{appNum}      -> single application
//   • GET /api/v1/patent/applications/search?q=...  -> search (find-to-add)
// Each record carries applicationMetaData + eventDataBag (prosecution history),
// which is what we diff to detect status changes.

const ODP_BASE = 'https://api.uspto.gov';
const SEARCH_PATH = '/api/v1/patent/applications/search';

const esc = (s) => String(s).replace(/["\\]/g, ' ').trim();
const digits = (s) => String(s).replace(/[^0-9]/g, '');

function tokenAnd(field, value) {
  const toks = esc(value).split(/\s+/).filter(Boolean).map((t) => `"${t}"`);
  return toks.length ? `${field}:(${toks.join(' AND ')})` : '';
}

// Advanced query (used by "find your patent to add"). All fields AND-ed.
export function buildPatentQuery(f = {}) {
  const parts = [];
  if (f.firstName && f.lastName)
    parts.push(
      `applicationMetaData.inventorBag.lastName:"${esc(f.lastName)}" AND ` +
        `applicationMetaData.inventorBag.firstName:"${esc(f.firstName)}"`
    );
  else if (f.lastName) parts.push(`applicationMetaData.inventorBag.lastName:"${esc(f.lastName)}"`);
  else if (f.name) parts.push(tokenAnd('applicationMetaData.inventorBag.inventorNameText', f.name));
  if (f.assignee) parts.push(tokenAnd('applicationMetaData.firstApplicantName', f.assignee));
  if (f.title) parts.push(tokenAnd('applicationMetaData.inventionTitle', f.title));
  if (f.dateFrom || f.dateTo)
    parts.push(`applicationMetaData.filingDate:[${f.dateFrom || '1900-01-01'} TO ${f.dateTo || '2100-12-31'}]`);
  return parts.filter(Boolean).join(' AND ');
}

async function call(url, apiKey) {
  let res;
  try {
    res = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
  } catch {
    throw new Error('Network error reaching api.uspto.gov. Check your connection / key.');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('USPTO rejected the request (401/403) — check your API key.');
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Rate limited by USPTO (429). Wait and retry.');
  if (!res.ok) throw new Error(`USPTO API error ${res.status}.`);
  return res.json();
}

export async function searchApplications({ apiKey, q, offset = 0, limit = 50, sort }) {
  if (!apiKey) throw new Error('Enter your USPTO ODP API key first.');
  if (!q) throw new Error('Provide at least one search field.');
  const url = new URL(ODP_BASE + SEARCH_PATH);
  url.searchParams.set('q', q);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  if (sort) url.searchParams.set('sort', sort);
  const data = await call(url, apiKey);
  const bag = (data && (data.patentFileWrapperDataBag || data.results)) || [];
  return { patents: bag.map(normalizePatent), count: (data && data.count) ?? null };
}

// Add-by-number: application number (direct endpoint) or granted patent number (search).
export async function fetchPatent({ apiKey, number, type = 'application' }) {
  if (!apiKey) throw new Error('Enter your USPTO ODP API key first.');
  const n = digits(number);
  if (!n) throw new Error('Enter a valid number.');
  if (type === 'patent') {
    const { patents } = await searchApplications({
      apiKey, q: `applicationMetaData.patentNumber:"${n}"`, limit: 1,
    });
    if (!patents.length) throw new Error(`No granted patent ${number} found.`);
    return patents[0];
  }
  const data = await call(new URL(`${ODP_BASE}/api/v1/patent/applications/${n}`), apiKey);
  const entry = data && (data.patentFileWrapperDataBag || [])[0];
  if (!entry) throw new Error(`No application ${number} found.`);
  return normalizePatent(entry);
}

export function normalizePatent(entry) {
  const m = entry.applicationMetaData || entry || {};
  const inventors = Array.isArray(m.inventorBag) ? m.inventorBag : [];
  const inv0 = inventors[0] || {};
  const addr = (inv0.correspondenceAddressBag && inv0.correspondenceAddressBag[0]) || {};
  const appNum = entry.applicationNumberText || m.applicationNumberText || '';

  const events = Array.isArray(entry.eventDataBag) ? entry.eventDataBag : [];
  let latest = null;
  for (const e of events) if (!latest || (e.eventDate || '') > (latest.eventDate || '')) latest = e;
  // Keep a compact, sorted prosecution history for the timeline view.
  const timeline = events
    .map((e) => ({ date: e.eventDate || '', description: e.eventDescriptionText || e.eventCode || '' }))
    .filter((e) => e.date || e.description)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 40);

  return {
    applicationNumberText: appNum,
    inventionTitle: m.inventionTitle || '',
    filingDate: m.filingDate || m.effectiveFilingDate || '',
    status: m.applicationStatusDescriptionText || '',
    statusDate: m.applicationStatusDate || '',
    type: m.applicationTypeLabelName || m.applicationTypeCategory || '',
    patentNumber: m.patentNumber || '',
    grantDate: m.grantDate || '',
    publicationNumber: m.earliestPublicationNumber || '',
    assignee:
      m.firstApplicantName ||
      (m.applicantBag && m.applicantBag[0] && m.applicantBag[0].applicantNameText) || '',
    inventors: inventors.map((i) => i.inventorNameText).filter(Boolean).join('; '),
    inventorState: addr.geographicRegionCode || '',
    inventorCity: addr.cityName || '',
    inventorCountry: addr.countryCode || '',
    latestEvent: latest ? latest.eventDescriptionText || '' : '',
    latestEventDate: latest ? latest.eventDate || '' : '',
    timeline,
    link: patentLink(m),
    source: 'public',
  };
}

// A compact fingerprint of the "live" fields. If it changes between checks, the
// application advanced.
export function patentSnapshot(p) {
  return [p.status, p.statusDate, p.latestEvent, p.latestEventDate].join(' | ');
}

function patentLink(m) {
  if (m.patentNumber) return `https://patents.google.com/patent/US${m.patentNumber}`;
  if (m.earliestPublicationNumber) return `https://patents.google.com/patent/${m.earliestPublicationNumber}`;
  return 'https://patentcenter.uspto.gov/';
}
