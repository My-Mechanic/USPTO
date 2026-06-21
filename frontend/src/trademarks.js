// Trademark search.
//
// There is no free, official, browser-callable USPTO trademark search API
// (tmsearch.uspto.gov blocks direct calls; TSDR/assignment APIs need separate
// keys and send no CORS headers). So owner-name trademark search runs through the
// LOCAL bridge (backend-automation), which drives the public USPTO Trademark
// Search site with a real browser — the same pattern as private patents.
//
// On the deployed public site this is unavailable; use Import JSON with results
// captured locally (`npm run trademarks -- "OWNER NAME"`).

const BRIDGE = import.meta.env.VITE_SYNC_BRIDGE_URL || 'http://127.0.0.1:8787';

export function bridgeAvailableHere() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

export async function searchTrademarks({ owner, onStatus = () => {} }) {
  if (!owner) throw new Error('Enter an owner / company name.');
  if (!bridgeAvailableHere()) {
    throw new Error(
      'Trademark search runs from the local app only (the free USPTO trademark ' +
        'search has no public browser API). Run it locally, or use Import JSON.'
    );
  }

  onStatus('Searching USPTO Trademark Search for this owner…');
  let res;
  try {
    res = await fetch(`${BRIDGE}/trademarks?owner=${encodeURIComponent(owner)}`);
  } catch {
    throw new Error(
      `Local bridge not reachable at ${BRIDGE}. Start it: ` +
        '`cd backend-automation && npm run server`.'
    );
  }
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Bridge error ${res.status}. ${msg}`);
  }
  const data = await res.json();
  return data.trademarks || [];
}

export function normalizeTrademark(t) {
  return {
    serialNumber: String(t.serialNumber || t.serial || '').trim(),
    registrationNumber: t.registrationNumber || '',
    markText: t.markText || t.mark || t.wordMark || '(design mark)',
    owner: t.owner || t.ownerName || '',
    status: t.status || t.statusText || '',
    filingDate: t.filingDate || '',
    registrationDate: t.registrationDate || '',
    link: t.serialNumber
      ? `https://tsdr.uspto.gov/#caseNumber=${t.serialNumber}&caseType=SERIAL_NO&searchType=statusSearch`
      : '',
    source: 'trademark',
  };
}
