// store.js — IndexedDB persistence for sessions + imported program + app metadata.
// Everything lives on-device; nothing is sent anywhere unless you use Export.

const DB_NAME = 'coach-claude';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_META = 'meta';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result.value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// ---- Sessions ----------------------------------------------------------

export function newSessionId() {
  return 's-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

export function saveSession(session) {
  return tx(STORE_SESSIONS, 'readwrite', s => {
    const box = {};
    s.put(session);
    box.value = session;
    return box;
  });
}

export function getSessions() {
  return tx(STORE_SESSIONS, 'readonly', s => {
    const box = {};
    const req = s.getAll();
    req.onsuccess = () => {
      box.value = (req.result || []).sort((a, b) =>
        (b.date + (b.id || '')).localeCompare(a.date + (a.id || '')));
    };
    return box;
  });
}

export function getSession(id) {
  return tx(STORE_SESSIONS, 'readonly', s => {
    const box = {};
    const req = s.get(id);
    req.onsuccess = () => { box.value = req.result || null; };
    return box;
  });
}

export function deleteSession(id) {
  return tx(STORE_SESSIONS, 'readwrite', s => {
    s.delete(id);
    return { value: true };
  });
}

// ---- Meta (key/value) --------------------------------------------------

export function setMeta(key, value) {
  return tx(STORE_META, 'readwrite', s => {
    s.put({ key, value });
    return { value };
  });
}

export function getMeta(key) {
  return tx(STORE_META, 'readonly', s => {
    const box = {};
    const req = s.get(key);
    req.onsuccess = () => { box.value = req.result ? req.result.value : null; };
    return box;
  });
}
