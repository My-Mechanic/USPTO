// Service worker — makes the app installable and usable offline.
//
// Strategy:
//   • Navigations  → network-first, fall back to cached shell when offline.
//   • Same-origin GET (JS/CSS/icons/JSON) → stale-while-revalidate.
//   • Cross-origin (USPTO APIs) → passthrough, never cached (live data only).
// The published trademark-status.json is same-origin and benefits from SWR so the
// dashboard still renders the last-known status offline.

const CACHE = 'uspto-portfolio-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Don't touch cross-origin (USPTO ODP / TSDR) — always live.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
