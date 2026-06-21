// USPTO Open Data Portal (ODP) public API client.
//
// Docs: https://data.uspto.gov/apis/patent-file-wrapper/search
// Base: https://api.uspto.gov   Auth header: X-API-Key
// Get a key: sign in at https://data.uspto.gov/myodp (USPTO.gov account + ID.me),
// then request a key on the Getting Started page.
//
// The endpoint and auth header below are stable; the exact *field* names in the
// response and the query-field syntax can evolve. Verify against the live Swagger
// if a field shows blank, and adjust normalizePatent()/buildQueryForName().

const ODP_BASE = 'https://api.uspto.gov';
const SEARCH_PATH = '/api/v1/patent/applications/search';

// Build an ODP query that looks for a person's name across inventor + applicant
// fields. ODP uses a Lucene-like "simplified syntax".
export function buildQueryForName(name) {
  const safe = String(name).replace(/["\\]/g, ' ').trim();
  if (!safe) return '';
  return (
    `applicationMetaData.inventorBag.inventorNameText:("${safe}") ` +
    `OR applicationMetaData.firstInventorName:("${safe}") ` +
    `OR applicationMetaData.firstApplicantName:("${safe}")`
  );
}

// Fetch one page of public applications. Returns { patents, count, raw }.
export async function searchApplications({ apiKey, q, offset = 0, limit = 100, sort }) {
  if (!apiKey) throw new Error('Enter your USPTO ODP API key first.');
  if (!q) throw new Error('Provide a name or a raw query.');

  const url = new URL(ODP_BASE + SEARCH_PATH);
  url.searchParams.set('q', q);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  if (sort) url.searchParams.set('sort', sort);

  let res;
  try {
    res = await fetch(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error(
      'Network/CORS error reaching api.uspto.gov. Check your connection and that the key is valid.'
    );
  }

  if (res.status === 401 || res.status === 403)
    throw new Error('USPTO rejected the request (401/403) — check your API key.');
  if (res.status === 429)
    throw new Error('Rate limited by USPTO (429). Wait a moment and retry.');
  if (!res.ok) throw new Error(`USPTO API error ${res.status}.`);

  const data = await res.json();
  const bag = data.patentFileWrapperDataBag || data.results || data.data || [];
  return {
    patents: bag.map(normalizePatent),
    count: data.count ?? data.totalResults ?? data.recordTotalQuantity ?? null,
    raw: data,
  };
}

// Map an ODP record to the flat shape the UI/IndexedDB use.
export function normalizePatent(entry) {
  const m = entry.applicationMetaData || entry || {};
  return {
    applicationNumberText:
      entry.applicationNumberText || m.applicationNumberText || '',
    inventionTitle: m.inventionTitle || m.inventionTitleText || '',
    filingDate: m.filingDate || m.effectiveFilingDate || '',
    status: m.applicationStatusDescriptionText || m.applicationStatusCategory || '',
    statusDate: m.applicationStatusDate || '',
    type: m.applicationTypeLabelName || m.applicationTypeCategory || '',
    patentNumber: m.patentNumber || '',
    source: 'public',
  };
}
