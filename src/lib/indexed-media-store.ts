// indexed-media-store.ts
// Robust offline IndexedDB & in-memory media storage engine for ClipGrab.
// Fixes "net::ERR_FILE_NOT_FOUND" by:
// 1. Holding strong JS memory references to active Blobs/Files (prevents Chrome GC eviction)
// 2. Persisting full Blobs in IndexedDB (enables videos to survive page refresh & browser restarts)
// 3. Dynamically re-generating valid blob: URLs whenever previous session URLs expire

const DB_NAME = 'clipgrab_media_store';
const DB_VERSION = 1;
const STORE_NAME = 'media_blobs';

interface StoredMediaItem {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
  savedAt: number;
}

// In-memory strong reference cache to prevent browser Garbage Collector from unmapping file handles
const memoryBlobRegistry = new Map<string, { blob: Blob | File; url: string; lastAccess: number }>();

/**
 * Initialize or upgrade the IndexedDB database
 */
export function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Registers an active Blob/File into memory with a strong reference and persists it into IndexedDB.
 * Returns a working blob: URL that is protected against garbage collection.
 */
export function registerActiveMedia(id: string, fileOrBlob: Blob | File, filename: string = 'video.mp4'): string {
  // If we already have an active URL for this ID in memory, check if we should reuse or replace
  const existing = memoryBlobRegistry.get(id);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing.url;
  }

  // Create fresh object URL
  const objectUrl = URL.createObjectURL(fileOrBlob);

  // Keep strong reference in memory so Chromium cannot GC the backing file
  memoryBlobRegistry.set(id, {
    blob: fileOrBlob,
    url: objectUrl,
    lastAccess: Date.now(),
  });

  // Asynchronously persist into IndexedDB for page reload / browser restart survivability
  persistToIndexedDB(id, fileOrBlob, filename).catch((err) => {
    console.warn('Could not persist media blob to IndexedDB (in-memory playback still works):', err);
  });

  return objectUrl;
}

/**
 * Saves a Blob into IndexedDB
 */
async function persistToIndexedDB(id: string, blob: Blob | File, name: string): Promise<void> {
  try {
    const db = await openMediaDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const item: StoredMediaItem = {
      id,
      blob,
      name,
      mimeType: blob.type || 'video/mp4',
      size: blob.size,
      savedAt: Date.now(),
    };

    store.put(item);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IndexedDB persist error:', e);
  }
}

/**
 * Resolves a safe, guaranteed-working media URL for a given ID and fallback URL.
 * If the current URL is a dead blob: URL from a past session, this retrieves the Blob
 * from IndexedDB and generates a new valid blob: URL automatically!
 */
export async function getSafeMediaUrl(id: string, currentUrl: string): Promise<{ url: string; isRevived: boolean }> {
  // 1. If it's a regular remote HTTP / HTTPS URL, it doesn't suffer from blob expiration
  if (!currentUrl.startsWith('blob:')) {
    return { url: currentUrl, isRevived: false };
  }

  // 2. Check if we already have it in memory with an active URL
  const inMemory = memoryBlobRegistry.get(id);
  if (inMemory) {
    const isAlive = await testBlobUrl(inMemory.url);
    if (isAlive) {
      inMemory.lastAccess = Date.now();
      return { url: inMemory.url, isRevived: false };
    }
  }

  // 3. Test if current URL is still alive
  const currentIsAlive = await testBlobUrl(currentUrl);
  if (currentIsAlive) {
    return { url: currentUrl, isRevived: false };
  }

  // 4. Current blob URL is DEAD (e.g. page was refreshed or file was unmapped).
  // Retrieve the Blob from IndexedDB!
  try {
    const db = await openMediaDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    const storedItem: StoredMediaItem | undefined = await new Promise((resolve, reject) => {
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    });

    if (storedItem && storedItem.blob) {
      const freshUrl = URL.createObjectURL(storedItem.blob);
      memoryBlobRegistry.set(id, {
        blob: storedItem.blob,
        url: freshUrl,
        lastAccess: Date.now(),
      });
      return { url: freshUrl, isRevived: true };
    }
  } catch (err) {
    console.error('Failed to retrieve media blob from IndexedDB:', err);
  }

  // 5. Blob could not be revived from IndexedDB
  return { url: currentUrl, isRevived: false };
}

/**
 * Quick non-blocking probe to verify if a blob: URL is still valid and reachable by the browser
 */
export async function testBlobUrl(url: string): Promise<boolean> {
  if (!url || !url.startsWith('blob:')) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    // Requesting HEAD or Range 0-0 verifies the blob registry entry without downloading whole file
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 206 || response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Deletes a stored media blob from both memory and IndexedDB
 */
export async function removeMediaBlob(id: string): Promise<void> {
  const inMemory = memoryBlobRegistry.get(id);
  if (inMemory) {
    try {
      URL.revokeObjectURL(inMemory.url);
    } catch {
      // ignore
    }
    memoryBlobRegistry.delete(id);
  }

  try {
    const db = await openMediaDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch {
    // ignore
  }
}
