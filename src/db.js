// Helper IndexedDB untuk file besar (PDF & musik).
// Nama lama dipertahankan agar PDF & musik tersimpan tidak hilang.
const DB_NAME = 'studyplan';
const VERSION = 3;
const STORES = ['pdfs', 'tracks', 'thumbs', 'wallpapers'];
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      // Tutup koneksi lama jika tab lain butuh upgrade versi database.
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const dbPut = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const dbGet = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const dbAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const dbDelete = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
