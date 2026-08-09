import type { LocalMediaRecord } from './types';

const DB_NAME = 'xiafork_local_media';
const DB_VERSION = 1;
const TRACK_STORE = 'xiafork_tracks';
let connection: Promise<IDBDatabase> | null = null;

export function openLocalMediaDB(): Promise<IDBDatabase> {
  if (connection) return connection;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        const store = db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
        store.createIndex('fingerprint', 'fingerprint', { unique: true });
        store.createIndex('importedAt', 'importedAt');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked request can later succeed after this promise was rejected.
      // Never retain that late connection as an unowned database handle.
      if (connection !== pending) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        if (connection === pending) connection = null;
      };
      db.onclose = () => { if (connection === pending) connection = null; };
      resolve(db);
    };
    request.onerror = () => {
      if (connection === pending) connection = null;
      reject(request.error);
    };
    request.onblocked = () => {
      if (connection === pending) connection = null;
      reject(new Error('Local media database is blocked by another tab'));
    };
  });
  connection = pending;
  return pending;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Local media transaction aborted'));
  });
}

export async function findLocalTrackByFingerprint(fingerprint: string): Promise<LocalMediaRecord | null> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readonly');
  return (await requestResult(tx.objectStore(TRACK_STORE).index('fingerprint').get(fingerprint))) || null;
}

export async function putLocalTrack(record: LocalMediaRecord): Promise<'stored' | 'duplicate'> {
  if (await findLocalTrackByFingerprint(record.fingerprint)) return 'duplicate';
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readwrite');
  tx.objectStore(TRACK_STORE).put(record);
  try {
    await transactionDone(tx);
    return 'stored';
  } catch (error) {
    if ((error as DOMException)?.name === 'ConstraintError') return 'duplicate';
    throw error;
  }
}

export async function listLocalTracks(): Promise<LocalMediaRecord[]> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readonly');
  const records = await requestResult(tx.objectStore(TRACK_STORE).getAll()) as LocalMediaRecord[];
  return records.sort((a, b) => b.importedAt - a.importedAt);
}

export async function getLocalTrack(id: string): Promise<LocalMediaRecord | null> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readonly');
  return (await requestResult(tx.objectStore(TRACK_STORE).get(id))) || null;
}

export async function getLocalTrackBlob(id: string): Promise<Blob | null> {
  return (await getLocalTrack(id))?.audioBlob || null;
}

export async function getLocalArtworkBlob(id: string): Promise<Blob | null> {
  return (await getLocalTrack(id))?.artworkBlob || null;
}

export async function removeLocalTrack(id: string): Promise<void> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readwrite');
  tx.objectStore(TRACK_STORE).delete(id);
  await transactionDone(tx);
}

export const LOCAL_ARTWORK_PREFIX = 'xiafork-local-artwork:';
export const localArtworkRef = (id: string): string => `${LOCAL_ARTWORK_PREFIX}${id}`;
export const isLocalArtworkRef = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(LOCAL_ARTWORK_PREFIX);
