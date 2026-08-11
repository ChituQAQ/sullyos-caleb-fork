import type { LocalMediaRecord, LocalMediaSourceRoot, LyricsDocument, WebFileSystemDirectoryHandle, WebFileSystemFileHandle } from './types';
import { resolveLocalMediaRecord } from './sourceResolver';

const DB_NAME = 'xiafork_local_media';
const DB_VERSION = 2;
const TRACK_STORE = 'xiafork_tracks';
const SOURCE_ROOT_STORE = 'xiafork_source_roots';
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
      if (!db.objectStoreNames.contains(SOURCE_ROOT_STORE)) {
        const roots = db.createObjectStore(SOURCE_ROOT_STORE, { keyPath: 'id' });
        roots.createIndex('importedAt', 'importedAt');
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
  const record = await getLocalTrack(id);
  return record ? resolveLocalMediaRecord(record, {
    requestPermission: true,
    getDirectoryRoot: getLocalMediaSourceRoot,
  }) : null;
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

export async function replaceLocalTrackWebHandle(id: string, handle: WebFileSystemFileHandle): Promise<void> {
  const record = await getLocalTrack(id);
  if (!record || record.schemaVersion !== 2) throw new Error('只能为引用模式曲目重新授权');
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readwrite');
  tx.objectStore(TRACK_STORE).put({ ...record, source: { kind: 'web-file-handle', handle } });
  await transactionDone(tx);
}

/** Explicit same-file re-import repair path for normalization changes. */
export async function replaceLocalTrackLyrics(id: string, lyrics: LyricsDocument): Promise<void> {
  const record = await getLocalTrack(id);
  if (!record) throw new Error('找不到本地曲目');
  const db = await openLocalMediaDB();
  const tx = db.transaction(TRACK_STORE, 'readwrite');
  tx.objectStore(TRACK_STORE).put({ ...record, lyrics });
  await transactionDone(tx);
}

export async function putLocalMediaSourceRoot(root: LocalMediaSourceRoot): Promise<void> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(SOURCE_ROOT_STORE, 'readwrite');
  tx.objectStore(SOURCE_ROOT_STORE).put(root);
  await transactionDone(tx);
}

export async function getLocalMediaSourceRoot(id: string): Promise<LocalMediaSourceRoot | null> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(SOURCE_ROOT_STORE, 'readonly');
  return (await requestResult(tx.objectStore(SOURCE_ROOT_STORE).get(id))) || null;
}

export async function listLocalMediaSourceRoots(): Promise<LocalMediaSourceRoot[]> {
  const db = await openLocalMediaDB();
  const tx = db.transaction(SOURCE_ROOT_STORE, 'readonly');
  return await requestResult(tx.objectStore(SOURCE_ROOT_STORE).getAll()) as LocalMediaSourceRoot[];
}

export async function replaceLocalMediaDirectoryHandle(id: string, handle: WebFileSystemDirectoryHandle): Promise<void> {
  const root = await getLocalMediaSourceRoot(id);
  if (!root) throw new Error('找不到音乐文件夹来源');
  await putLocalMediaSourceRoot({ ...root, name: handle.name, handle });
}

export const LOCAL_ARTWORK_PREFIX = 'xiafork-local-artwork:';
export const localArtworkRef = (id: string): string => `${LOCAL_ARTWORK_PREFIX}${id}`;
export const isLocalArtworkRef = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(LOCAL_ARTWORK_PREFIX);
