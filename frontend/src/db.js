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

export async function saveRecords(records) {
  if (!records || !records.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patents', 'readwrite');
    const os = tx.objectStore('patents');
    for (const r of records) if (r && r.applicationNumberText) os.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
