// USPTO Open Data Portal (ODP) public patent API client.
//
// Verified live against https://api.uspto.gov/api/v1/patent/applications/search :
//   • Auth header: X-API-Key   • CORS: Access-Control-Allow-Origin: *
//   • Response: { count, patentFileWrapperDataBag: [ { applicationNumberText,
//       applicationMetaData: { inventionTitle, filingDate, firstInventorName,
//       firstApplicantName, applicationStatusDescriptionText, inventorBag:[{
//       firstName,lastName,inventorNameText, correspondenceAddressBag:[{cityName,
//       geographicRegionCode,countryCode}]}], patentNumber, grantDate,
//       earliestPublicationNumber, applicantBag:[{applicantNameText}] } } ] }

const ODP_BASE = 'https://api.uspto.gov';
const SEARCH_PATH = '/api/v1/patent/applications/search';

const esc = (s) => String(s).replace(/["\\]/g, ' ').trim();

// field:( "tok1" AND "tok2" ) — lenient token match (e.g. "John Smith" also
// matches "John A. Smith").
function tokenAnd(field, value) {
  const toks = esc(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`);
  return toks.length ? `${field}:(${toks.join(' AND ')})` : '';
}

// Build a precise ODP query from the advanced-search fields. Every provided field
// is AND-ed together — THIS is what separates same-name inventors.
//   { firstName, lastName, name, assignee, title, dateFrom, dateTo, status }
export function buildPatentQuery(f = {}) {
  const parts = [];

  if (f.firstName && f.lastName) {
    // Most precise: a single inventor whose first AND last name match.
    parts.push(
      `applicationMetaData.inventorBag.lastName:"${esc(f.lastName)}" AND ` +
        `applicationMetaData.inventorBag.firstName:"${esc(f.firstName)}"`
    );
  } else if (f.lastName) {
    parts.push(`applicationMetaData.inventorBag.lastName:"${esc(f.lastName)}"`);
  } else if (f.name) {
    parts.push(tokenAnd('applicationMetaData.inventorBag.inventorNameText', f.name));
  }

  if (f.assignee) parts.push(tokenAnd('applicationMetaData.firstApplicantName', f.assignee));
  if (f.title) parts.push(tokenAnd('applicationMetaData.inventionTitle', f.title));
  if (f.status) parts.push(tokenAnd('applicationMetaData.applicationStatusDescriptionText', f.status));

  if (f.dateFrom || f.dateTo) {
    const a = f.dateFrom || '1900-01-01';
    const b = f.dateTo || '2100-12-31';
    parts.push(`applicationMetaData.filingDate:[${a} TO ${b}]`);
  }

  return parts.filter(Boolean).join(' AND ');
}

// Fetch one page. Returns { patents, count, raw }.
export async function searchApplications({ apiKey, q, offset = 0, limit = 100, sort }) {
  if (!apiKey) throw new Error('Enter your USPTO ODP API key first.');
  if (!q) throw new Error('Provide at least one search field.');

  const url = new URL(ODP_BASE + SEARCH_PATH);
  url.searchParams.set('q', q);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  if (sort) url.searchParams.set('sort', sort);

  let res;
  try {
    res = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
  } catch {
    throw new Error('Network error reaching api.uspto.gov. Check your connection / key.');
  }

  if (res.status === 401 || res.status === 403)
    throw new Error('USPTO rejected the request (401/403) — check your API key.');
  if (res.status === 429) throw new Error('Rate limited by USPTO (429). Wait and retry.');
  if (!res.ok) throw new Error(`USPTO API error ${res.status}.`);

  const data = await res.json();
  const bag = data.patentFileWrapperDataBag || data.results || [];
  return {
    patents: bag.map(normalizePatent),
    count: data.count ?? null,
    raw: data,
  };
}

export function normalizePatent(entry) {
  const m = entry.applicationMetaData || entry || {};
  const inventors = Array.isArray(m.inventorBag) ? m.inventorBag : [];
  const inv0 = inventors[0] || {};
  const addr = (inv0.correspondenceAddressBag && inv0.correspondenceAddressBag[0]) || {};
  const appNum = entry.applicationNumberText || m.applicationNumberText || '';
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
      (m.applicantBag && m.applicantBag[0] && m.applicantBag[0].applicantNameText) ||
      '',
    inventors: inventors.map((i) => i.inventorNameText).filter(Boolean).join('; '),
    inventorState: addr.geographicRegionCode || '',
    inventorCity: addr.cityName || '',
    inventorCountry: addr.countryCode || '',
    link: patentLink(m),
    source: 'public',
  };
}

function patentLink(m) {
  if (m.patentNumber) return `https://patents.google.com/patent/US${m.patentNumber}`;
  if (m.earliestPublicationNumber)
    return `https://patents.google.com/patent/${m.earliestPublicationNumber}`;
  return 'https://ppubs.uspto.gov/pubwebapp/';
}
