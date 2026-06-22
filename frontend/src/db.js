// Local-only persistence for the PATENT watchlist. Trademarks are served from the
// Action-generated trademark-status.json (see trademarks.js), so they don't need
// IndexedDB. The API key lives in localStorage. Nothing leaves the browser.

const DB_NAME = 'uspto-patents';
const DB_VERSION = 3; // v3: 'patents' watchlist store

const STORES = { patents: 'applicationNumberText' };

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const digitsOnly = (s) => String(s == null ? '' : s).replace(/[^0-9]/g, '');

// Canonical identity for a patent: digits-only application number, else patent #.
// Two records with the same canonical key are the same application.
export function patentKey(p) {
  return digitsOnly(p.applicationNumberText) || (p.patentNumber ? 'pat:' + digitsOnly(p.patentNumber) : '');
}

export async function saveRecords(records) {
  if (!records || !records.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readwrite');
    const os = tx.objectStore('patents');
    // Normalize the key on write so the same application can't be stored twice
    // under different formats (e.g. "18/123,456" vs "18123456").
    for (const r of records) {
      if (!r || !r.applicationNumberText) continue;
      const canon = digitsOnly(r.applicationNumberText);
      os.put(canon && canon !== r.applicationNumberText ? { ...r, applicationNumberText: canon } : r);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Merge a set of records that refer to the same application into one, preferring
// the most recent non-empty field values and unioning user data (tags/note).
function mergePatentGroup(recs) {
  const oldestFirst = [...recs].sort((a, b) => (a.lastChecked || '').localeCompare(b.lastChecked || ''));
  const out = {};
  const tags = new Set();
  let addedAt = '';
  for (const r of oldestFirst) {
    for (const [k, v] of Object.entries(r)) {
      const empty = v === '' || v == null || (Array.isArray(v) && !v.length);
      if (!empty) out[k] = v; // newer non-empty overrides older
    }
    for (const t of r.tags || []) tags.add(t);
    if (r.addedAt && (!addedAt || r.addedAt < addedAt)) addedAt = r.addedAt; // keep earliest
  }
  out.applicationNumberText = digitsOnly(out.applicationNumberText) || out.applicationNumberText;
  if (tags.size) out.tags = [...tags];
  if (addedAt) out.addedAt = addedAt;
  return out;
}

// Actively remove duplicate applications: group by canonical key, merge each
// group into one record, re-key to digits-only. Returns the count removed.
export async function dedupePatents() {
  const all = await getRecords();
  const groups = new Map();
  for (const r of all) {
    const key = patentKey(r) || r.applicationNumberText || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const db = await openDB();
  let removed = 0;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readwrite');
    const os = tx.objectStore('patents');
    for (const recs of groups.values()) {
      if (recs.length === 1) {
        const r = recs[0];
        const canon = digitsOnly(r.applicationNumberText);
        if (canon && canon !== r.applicationNumberText) { os.delete(r.applicationNumberText); os.put({ ...r, applicationNumberText: canon }); }
        continue;
      }
      const merged = mergePatentGroup(recs);
      for (const r of recs) os.delete(r.applicationNumberText);
      os.put(merged);
      removed += recs.length - 1;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return removed;
}

export async function getRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readonly');
    const req = tx.objectStore('patents').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(appNum) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readwrite');
    tx.objectStore('patents').delete(appNum);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readwrite');
    tx.objectStore('patents').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const settings = {
  getApiKey: () => localStorage.getItem('odp_api_key') || '',
  setApiKey: (k) => localStorage.setItem('odp_api_key', k || ''),
};
