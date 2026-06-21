// Local-only persistence. Records live in IndexedDB; the API key in localStorage.
// Nothing leaves the browser.

const DB_NAME = 'uspto-patents';
const DB_VERSION = 2; // bumped: added 'trademarks' store

// store name -> keyPath
const STORES = {
  public: 'applicationNumberText',
  private: 'applicationNumberText',
  trademarks: 'serialNumber',
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecords(store, records) {
  if (!records || !records.length) return;
  const key = STORES[store];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of records) if (r && r[key]) os.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRecords(store) {
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
