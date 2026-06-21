// Bridge to the LOCAL automation server (backend-automation/server.js) that drives
// Playwright for private/pending applications.
//
// This only works when the app itself is served from localhost, because a page
// served over HTTPS (GitHub Pages) cannot call http://127.0.0.1 (mixed content is
// blocked by browsers — by design, and we do not want to weaken it). On the public
// site, capture private data locally with `npm run scrape`, then use "Import JSON".

const BRIDGE =
  import.meta.env.VITE_SYNC_BRIDGE_URL || 'http://127.0.0.1:8787';

export function bridgeAvailableHere() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

export async function syncPrivate({ onStatus = () => {} } = {}) {
  if (!bridgeAvailableHere()) {
    throw new Error(
      'Private sync runs only from the local app (http://localhost:5173). ' +
        'On the public site, run "npm run scrape" locally and use "Import JSON".'
    );
  }

  onStatus('Contacting local automation bridge…');
  let res;
  try {
    res = await fetch(`${BRIDGE}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (e) {
    throw new Error(
      `Could not reach the local bridge at ${BRIDGE}. Start it with ` +
        '`cd backend-automation && npm run server`.'
    );
  }

  if (res.status === 409)
    throw new Error('A sync is already running in the open browser window.');
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Bridge error ${res.status}. ${msg}`);
  }

  const data = await res.json();
  return data.patents || [];
}
