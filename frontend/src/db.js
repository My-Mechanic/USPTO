// Local-only persistence. Patents live in IndexedDB; the API key lives in
// localStorage. Nothing leaves the browser.

const DB_NAME = 'uspto-patents';
const DB_VERSION = 1;
const STORES = ['public', 'private'];
const KEY_NAME = 'applicationNumberText';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: KEY_NAME });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePatents(store, patents) {
  if (!patents || !patents.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const p of patents) {
      if (p && p[KEY_NAME]) os.put(p);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPatents(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const settings = {
  getApiKey: () => localStorage.getItem('odp_api_key') || '',
  setApiKey: (k) => localStorage.setItem('odp_api_key', k || ''),
};
