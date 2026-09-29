// Local-only persistence in IndexedDB. Nothing here talks to a network.
//
// Stores:
//   kv        key -> value   (profile, stone, settings, visit)
//   checkins  keyPath 'date' (YYYY-MM-DD), one check-in per day
//
// If IndexedDB is unavailable (some private-browsing modes) we fall back to
// memory so the app still works for the session; app.js warns the user.

const DB_NAME = 'firststone';
const DB_VERSION = 1;

let dbp = null;
let memory = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

function mem() {
  if (!memory) memory = { kv: new Map(), checkins: new Map() };
  return memory;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function persistent() {
  return (await open()) !== null;
}

export async function get(key) {
  const db = await open();
  if (!db) return mem().kv.get(key);
  return tx(db, 'kv', 'readonly', (s) => s.get(key));
}

export async function set(key, value) {
  const db = await open();
  if (!db) return void mem().kv.set(key, value);
  return tx(db, 'kv', 'readwrite', (s) => s.put(value, key));
}

export async function allCheckins() {
  const db = await open();
  const list = db ? await tx(db, 'checkins', 'readonly', (s) => s.getAll()) : [...mem().checkins.values()];
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getCheckin(date) {
  const db = await open();
  if (!db) return mem().checkins.get(date);
  return tx(db, 'checkins', 'readonly', (s) => s.get(date));
}

export async function putCheckin(c) {
  const db = await open();
  if (!db) return void mem().checkins.set(c.date, c);
  return tx(db, 'checkins', 'readwrite', (s) => s.put(c));
}

export async function deleteCheckin(date) {
  const db = await open();
  if (!db) return void mem().checkins.delete(date);
  return tx(db, 'checkins', 'readwrite', (s) => s.delete(date));
}

export const KV_KEYS = ['profile', 'stone', 'settings', 'visit'];

export async function exportAll() {
  const out = { checkins: await allCheckins() };
  for (const k of KV_KEYS) out[k] = (await get(k)) ?? null;
  return out;
}

export async function importAll(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.checkins)) throw new Error('bad backup');
  await wipe();
  for (const k of KV_KEYS) if (data[k] != null) await set(k, data[k]);
  for (const c of data.checkins) if (c && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) await putCheckin(c);
}

export async function wipe() {
  const db = await open();
  if (!db) {
    memory = null;
    return;
  }
  await tx(db, 'kv', 'readwrite', (s) => s.clear());
  await tx(db, 'checkins', 'readwrite', (s) => s.clear());
}
