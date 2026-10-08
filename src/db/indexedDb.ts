import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { mapWithConcurrency, pickConcurrency } from '../lib/concurrency';

export type PhotoStatus = 'inbox' | 'kept' | 'trashed';

export interface AiAnalysis {
  isBlurry: boolean;
  isLowQuality: boolean;
  eyesClosed: boolean;
  isDocument: boolean;
  shortTags: string[];
  suggestedAlbum: string;
  suggestion: 'keep' | 'delete' | 'unsure';
  reason: string;
  suggestedCaption: string;
  milestone: string | null;
}

export interface Photo {
  id: string;
  blob: Blob;
  createdAt: number;
  capturedAt: number;
  status: PhotoStatus;
  albumId: string | null;
  analysis: AiAnalysis | null;
  note: string;
  isScreenshot: boolean;
  // When it was moved to Recently Deleted — it's removed for good TRASH_RETENTION_DAYS later.
  trashedAt?: number | null;
  // From the upload's EXIF read (see photoDate.ts). Missing on photos added before this existed,
  // which the sort treats as "unknown", never as "no camera".
  hasCameraExif?: boolean;
}

// The parts of a photo that change after upload. They live in their own small record so that
// keeping, setting aside, filing into an album or captioning a photo never rewrites the photo
// itself. Rewriting full-size images was slow, and iPhone Safari intermittently fails to
// re-store an image it has just read back from storage ("UnknownError: Error preparing
// Blob/File data") — which stopped "Create album" after the first photo.
export interface PhotoMeta {
  id: string;
  status: PhotoStatus;
  albumId: string | null;
  note: string;
  isScreenshot: boolean;
  trashedAt?: number | null;
}

function metaOf(photo: Photo): PhotoMeta {
  return {
    id: photo.id,
    status: photo.status,
    albumId: photo.albumId ?? null,
    note: photo.note ?? '',
    isScreenshot: photo.isScreenshot ?? false,
    trashedAt: photo.trashedAt ?? null,
  };
}

// The stored photo record still carries the values it was uploaded with; the meta record is
// the source of truth for status, album, caption, screenshot flag and trash date.
function withMeta(photo: Photo, meta: PhotoMeta | undefined): Photo {
  return meta ? { ...photo, status: meta.status, albumId: meta.albumId, note: meta.note, isScreenshot: meta.isScreenshot, trashedAt: meta.trashedAt } : photo;
}

export interface Album {
  id: string;
  name: string;
  createdAt: number;
}

export interface Person {
  id: string;
  name: string;
  createdAt: number;
  photoIds: string[];
  centroid: number[];
}

interface PhotoAppDB extends DBSchema {
  photos: {
    key: string;
    value: Photo;
    indexes: { 'by-status': PhotoStatus; 'by-album': string };
  };
  albums: {
    key: string;
    value: Album;
  };
  people: {
    key: string;
    value: Person;
  };
  // Small JPEG previews for grids, made during the sort — kept apart from the photo records so
  // writing one never rewrites (and re-copies) the full-size original.
  thumbs: {
    key: string;
    value: { id: string; blob: Blob };
  };
  meta: {
    key: string;
    value: PhotoMeta;
    indexes: { 'by-status': PhotoStatus; 'by-album': string };
  };
}

let dbPromise: Promise<IDBPDatabase<PhotoAppDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<PhotoAppDB>('photo-app', 7, {
      upgrade(db, oldVersion, _newVersion, tx) {
        let photos;
        if (oldVersion < 1) {
          photos = db.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('by-status', 'status');
          photos.createIndex('by-album', 'albumId');
          db.createObjectStore('albums', { keyPath: 'id' });
        } else {
          photos = tx.objectStore('photos');
        }
        if (oldVersion < 2) {
          // Backfill capturedAt for photos added before this field existed.
          photos.openCursor().then(function backfill(cursor): unknown {
            if (!cursor) return;
            if (cursor.value.capturedAt == null) {
              cursor.update({ ...cursor.value, capturedAt: cursor.value.createdAt });
            }
            return cursor.continue().then(backfill);
          });
        }
        if (oldVersion < 3) {
          // Backfill note for photos added before this field existed.
          photos.openCursor().then(function backfill(cursor): unknown {
            if (!cursor) return;
            if (cursor.value.note == null) {
              cursor.update({ ...cursor.value, note: '' });
            }
            return cursor.continue().then(backfill);
          });
        }
        if (oldVersion < 4) {
          // Backfill isScreenshot for photos added before this field existed.
          photos.openCursor().then(function backfill(cursor): unknown {
            if (!cursor) return;
            if (cursor.value.isScreenshot == null) {
              cursor.update({ ...cursor.value, isScreenshot: false });
            }
            return cursor.continue().then(backfill);
          });
        }
        if (oldVersion < 5) {
          db.createObjectStore('people', { keyPath: 'id' });
        }
        if (oldVersion < 6) {
          db.createObjectStore('thumbs', { keyPath: 'id' });
        }
        if (oldVersion < 7) {
          const meta = db.createObjectStore('meta', { keyPath: 'id' });
          meta.createIndex('by-status', 'status');
          meta.createIndex('by-album', 'albumId');
          // Copy each existing photo's status/album/caption into its own small record. Only the
          // small records are written — the photos (and their images) are just read.
          photos.openCursor().then(function copy(cursor): unknown {
            if (!cursor) return;
            meta.put(metaOf(cursor.value));
            return cursor.continue().then(copy);
          });
        }
      },
    });
  }
  return dbPromise;
}

export interface NewPhotoEntry {
  file: File;
  // Already a plain in-memory copy (not a live handle from the file picker) — saved as is,
  // without reading the bytes a second time.
  inMemory?: boolean;
  capturedAt: number;
  isScreenshot: boolean;
  hasCameraExif?: boolean;
}

export interface AddPhotosResult {
  added: number;
  failed: number;
  // The browser refused to store any more: this device's storage for the site is full.
  storageFull?: boolean;
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'QuotaExceededError' || /quota/i.test(String((err as Error)?.message ?? ''));
}

// Each photo gets its own transaction (via db.put, not a shared tx.store.put across the
// whole batch) — so if one photo's blob is bad, it fails in isolation instead of aborting
// the shared transaction and silently rolling back every other photo in the batch too.
export async function addPhotos(entries: NewPhotoEntry[]): Promise<AddPhotosResult> {
  const db = await getDb();
  let added = 0;
  let failed = 0;
  let storageFull = false;

  // Bounded concurrency, sized to the device — reading every file's full bytes into memory at
  // once for a batch of thousands would spike memory enough to hang the tab; too low a cap
  // just leaves cores idle. See lib/concurrency.ts.
  await mapWithConcurrency(entries, pickConcurrency(), async ({ file, capturedAt, isScreenshot, inMemory, hasCameraExif }) => {
    try {
      // Read the file's bytes into a plain, in-memory Blob before storing it — a raw File
      // from an <input type="file"> pick can end up saved as a live reference to the file on
      // disk rather than a true copy, and that reference goes stale after the browser's
      // temporary read permission for the pick session expires (surfaces as
      // "NotReadableError: permission problems" on a later page load). A Blob built from
      // already-read bytes has no such dependency and survives reloads.
      const safeBlob = inMemory
        ? file.type
          ? file
          : new Blob([file], { type: 'image/jpeg' })
        : new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' });
      const photo: Photo = {
        id: crypto.randomUUID(),
        blob: safeBlob,
        createdAt: Date.now(),
        capturedAt,
        status: 'inbox',
        albumId: null,
        analysis: null,
        note: '',
        isScreenshot,
        hasCameraExif,
      };
      const tx = db.transaction(['photos', 'meta'], 'readwrite');
      await Promise.all([tx.objectStore('photos').put(photo), tx.objectStore('meta').put(metaOf(photo)), tx.done]);
      added++;
    } catch (err) {
      console.error('Failed to save photo', file.name, err);
      if (isQuotaError(err)) storageFull = true;
      failed++;
    }
  });

  return { added, failed, storageFull };
}

export async function getAllPhotos(): Promise<Photo[]> {
  const db = await getDb();
  const tx = db.transaction(['photos', 'meta']);
  const [photos, metas] = await Promise.all([tx.objectStore('photos').getAll(), tx.objectStore('meta').getAll()]);
  const metaById = new Map(metas.map((m) => [m.id, m]));
  return photos.map((p) => withMeta(p, metaById.get(p.id)));
}

// Photos for a set of meta records, read in one transaction.
async function photosFor(metas: PhotoMeta[]): Promise<Photo[]> {
  const db = await getDb();
  const store = db.transaction('photos').objectStore('photos');
  const photos = await Promise.all(metas.map((m) => store.get(m.id)));
  return photos.flatMap((p, i) => (p ? [withMeta(p, metas[i])] : []));
}

export async function getPhotosByStatus(status: PhotoStatus): Promise<Photo[]> {
  const db = await getDb();
  return photosFor(await db.getAllFromIndex('meta', 'by-status', status));
}

// Changes only the small meta record — never the stored image.
async function updateMeta(id: string, change: Partial<Omit<PhotoMeta, 'id'>>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meta', 'photos'], 'readwrite');
  const metaStore = tx.objectStore('meta');
  let meta = await metaStore.get(id);
  if (!meta) {
    const photo = await tx.objectStore('photos').get(id);
    if (!photo) return;
    meta = metaOf(photo);
  }
  await metaStore.put({ ...meta, ...change });
  await tx.done;
}

export async function updatePhotoStatus(id: string, status: PhotoStatus): Promise<void> {
  await updateMeta(id, { status, trashedAt: status === 'trashed' ? Date.now() : null });
}

// "Save space" (see shrinkPhoto.ts): swaps a photo's stored image for its print-quality copy.
// The new image is a fresh in-memory one (never a Blob read back from storage, which iPhone
// Safari can fail to re-store), and only the image changes — status, album etc. live in meta.
export async function replacePhotoBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('photos', 'readwrite');
  const store = tx.objectStore('photos');
  const existing = await store.get(id);
  if (existing) await store.put({ ...existing, blob });
  await tx.done;
}

// Saves a whole review in ONE transaction: every kept photo (filed into the album, if any) and
// every set-aside photo — so it's either all saved or none of it, never half an album.
export async function savePhotoChoices(choices: { keepIds: string[]; trashIds: string[]; albumId: string | null }): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['meta', 'photos'], 'readwrite');
  const metaStore = tx.objectStore('meta');
  const photoStore = tx.objectStore('photos');
  const now = Date.now();
  async function apply(id: string, change: Partial<Omit<PhotoMeta, 'id'>>) {
    const meta = (await metaStore.get(id)) ?? (await photoStore.get(id).then((p) => (p ? metaOf(p) : undefined)));
    if (meta) await metaStore.put({ ...meta, ...change });
  }
  const done = tx.done;
  done.catch(() => {}); // a failure is reported below, not as an unhandled rejection
  // allSettled, not all: every in-flight write finishes (or is cancelled) before deciding, so a
  // cancelled transaction leaves no stray errors behind.
  const results = await Promise.allSettled([
    ...choices.keepIds.map((id) => apply(id, { status: 'kept', trashedAt: null, ...(choices.albumId ? { albumId: choices.albumId } : {}) })),
    ...choices.trashIds.map((id) => apply(id, { status: 'trashed', trashedAt: now })),
  ]);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    // Some storage errors are thrown straight from put() and don't cancel the transaction on
    // their own — cancel it explicitly so the photos that did go through are rolled back too.
    try {
      tx.abort();
    } catch {
      // Already finished or aborted.
    }
    throw failure.reason;
  }
  await done;
}

// Set-aside photos wait in Recently Deleted this long before they're removed for good —
// long enough to notice a mistake, short enough that the browser's storage doesn't fill up
// with thousands of photos nobody wanted (they used to be kept forever, invisibly).
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getTrashedPhotos(): Promise<Photo[]> {
  const trashed = await getPhotosByStatus('trashed');
  return trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

export function daysUntilPurge(photo: Photo, now = Date.now()): number {
  const since = photo.trashedAt ?? now;
  return Math.max(0, Math.ceil((since + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS));
}

export async function restorePhotos(ids: string[]): Promise<void> {
  await savePhotoChoices({ keepIds: ids, trashIds: [], albumId: null });
}

export async function deletePhotosForever(ids: string[]): Promise<void> {
  const db = await getDb();
  await Promise.all(ids.flatMap((id) => [db.delete('photos', id), db.delete('meta', id), db.delete('thumbs', id)]));
}

export async function getThumb(id: string): Promise<Blob | null> {
  const db = await getDb();
  return (await db.get('thumbs', id))?.blob ?? null;
}

export async function saveThumb(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('thumbs', { id, blob });
}

// Runs once per app load. Photos trashed before trashedAt existed get the full grace period
// starting now rather than being purged on the spot.
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const db = await getDb();
  const trashed = await db.getAllFromIndex('meta', 'by-status', 'trashed');
  let purged = 0;
  for (const meta of trashed) {
    if (meta.trashedAt == null) {
      await db.put('meta', { ...meta, trashedAt: now });
    } else if (now - meta.trashedAt >= TRASH_RETENTION_DAYS * DAY_MS) {
      await deletePhotosForever([meta.id]);
      purged++;
    }
  }
  return purged;
}

export async function setPhotoNote(id: string, note: string): Promise<void> {
  await updateMeta(id, { note });
}

// Permanently replaces a photo's stored blob — used to repair photos that were saved
// before HEIC conversion existed, so the fix only has to happen once per photo.
export async function fixPhotoBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.blob = blob;
  await db.put('photos', photo);
}

export async function setPhotoAnalysis(id: string, analysis: AiAnalysis): Promise<void> {
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.analysis = analysis;
  await db.put('photos', photo);
}

// AI-detected documents (receipts, forms, whiteboards) get filed the same place as
// screenshots — they aren't "memory" photos either.
export async function markAsScreenshot(id: string): Promise<void> {
  await updateMeta(id, { isScreenshot: true });
}

export async function getKeptPhotosWithoutAlbum(): Promise<Photo[]> {
  const kept = await getPhotosByStatus('kept');
  return kept.filter((p) => !p.albumId);
}

export async function assignPhotoToAlbum(id: string, albumId: string): Promise<void> {
  await updateMeta(id, { albumId, status: 'kept', trashedAt: null });
}

// Reuses an existing album if one already has this name (case-insensitive) instead of
// creating a duplicate folder every time — e.g. auto-sort suggesting "July 2026" twice
// should file into the same album both times.
export async function createAlbum(name: string): Promise<Album> {
  const db = await getDb();
  const existing = await db.getAll('albums');
  const match = existing.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (match) return match;

  const album: Album = { id: crypto.randomUUID(), name, createdAt: Date.now() };
  await db.put('albums', album);
  return album;
}

export async function getAllAlbums(): Promise<Album[]> {
  const db = await getDb();
  return db.getAll('albums');
}

// Deletes the album itself, but never the photos in it — they're ungrouped back into the
// general kept pool, same as the rest of the app's "delete never touches your photos" rule.
export async function deleteAlbum(id: string): Promise<number> {
  const db = await getDb();
  const metas = await db.getAllFromIndex('meta', 'by-album', id);
  const tx = db.transaction(['meta', 'albums'], 'readwrite');
  await Promise.all(metas.map((m) => tx.objectStore('meta').put({ ...m, albumId: null })));
  await tx.objectStore('albums').delete(id);
  await tx.done;
  return metas.length;
}

export async function getPhotosByAlbum(albumId: string): Promise<Photo[]> {
  const db = await getDb();
  return photosFor(await db.getAllFromIndex('meta', 'by-album', albumId));
}

export async function getPhotosByIds(ids: string[]): Promise<Photo[]> {
  const db = await getDb();
  const tx = db.transaction(['photos', 'meta']);
  const rows = await Promise.all(
    ids.map(async (id) => [await tx.objectStore('photos').get(id), await tx.objectStore('meta').get(id)] as const),
  );
  return rows.flatMap(([p, m]) => (p ? [withMeta(p, m)] : []));
}

export async function replaceAllPeople(people: Person[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('people', 'readwrite');
  await tx.store.clear();
  await Promise.all(people.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function getAllPeople(): Promise<Person[]> {
  const db = await getDb();
  return db.getAll('people');
}

export async function renamePerson(id: string, name: string): Promise<void> {
  const db = await getDb();
  const person = await db.get('people', id);
  if (!person) return;
  person.name = name;
  await db.put('people', person);
}

// Restoring a backup merges into whatever is already here instead of replacing it: photos and
// people already present (same id) are left alone, and an album that already exists under the
// same name is reused rather than duplicated.
export async function importLibraryRecords(
  photos: Photo[],
  albums: Album[],
  people: Person[],
): Promise<{ added: number; skipped: number; albums: number }> {
  const db = await getDb();
  const existingAlbums = await db.getAll('albums');
  const albumIdMap = new Map<string, string>();
  let newAlbums = 0;
  for (const album of albums) {
    const sameId = existingAlbums.find((a) => a.id === album.id);
    const sameName = existingAlbums.find((a) => a.name.trim().toLowerCase() === album.name.trim().toLowerCase());
    const target = sameId ?? sameName;
    if (target) {
      albumIdMap.set(album.id, target.id);
    } else {
      await db.put('albums', album);
      existingAlbums.push(album);
      albumIdMap.set(album.id, album.id);
      newAlbums++;
    }
  }

  let added = 0;
  let skipped = 0;
  for (const photo of photos) {
    if (await db.getKey('photos', photo.id)) {
      skipped++;
      continue;
    }
    const albumId = photo.albumId ? (albumIdMap.get(photo.albumId) ?? photo.albumId) : null;
    const restored = { ...photo, albumId };
    const tx = db.transaction(['photos', 'meta'], 'readwrite');
    await Promise.all([tx.objectStore('photos').put(restored), tx.objectStore('meta').put(metaOf(restored)), tx.done]);
    added++;
  }

  for (const person of people) {
    if (!(await db.getKey('people', person.id))) await db.put('people', person);
  }

  return { added, skipped, albums: newAlbums };
}
