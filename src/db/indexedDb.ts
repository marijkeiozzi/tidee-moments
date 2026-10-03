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
}

let dbPromise: Promise<IDBPDatabase<PhotoAppDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<PhotoAppDB>('photo-app', 6, {
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
}

export interface AddPhotosResult {
  added: number;
  failed: number;
}

// Each photo gets its own transaction (via db.put, not a shared tx.store.put across the
// whole batch) — so if one photo's blob is bad, it fails in isolation instead of aborting
// the shared transaction and silently rolling back every other photo in the batch too.
export async function addPhotos(entries: NewPhotoEntry[]): Promise<AddPhotosResult> {
  const db = await getDb();
  let added = 0;
  let failed = 0;

  // Bounded concurrency, sized to the device — reading every file's full bytes into memory at
  // once for a batch of thousands would spike memory enough to hang the tab; too low a cap
  // just leaves cores idle. See lib/concurrency.ts.
  await mapWithConcurrency(entries, pickConcurrency(), async ({ file, capturedAt, isScreenshot, inMemory }) => {
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
      await db.put('photos', {
        id: crypto.randomUUID(),
        blob: safeBlob,
        createdAt: Date.now(),
        capturedAt,
        status: 'inbox',
        albumId: null,
        analysis: null,
        note: '',
        isScreenshot,
      });
      added++;
    } catch (err) {
      console.error('Failed to save photo', file.name, err);
      failed++;
    }
  });

  return { added, failed };
}

export async function getAllPhotos(): Promise<Photo[]> {
  const db = await getDb();
  return db.getAll('photos');
}

export async function getPhotosByStatus(status: PhotoStatus): Promise<Photo[]> {
  const db = await getDb();
  return db.getAllFromIndex('photos', 'by-status', status);
}

export async function updatePhotoStatus(id: string, status: PhotoStatus): Promise<void> {
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.status = status;
  photo.trashedAt = status === 'trashed' ? Date.now() : null;
  await db.put('photos', photo);
}

// Set-aside photos wait in Recently Deleted this long before they're removed for good —
// long enough to notice a mistake, short enough that the browser's storage doesn't fill up
// with thousands of photos nobody wanted (they used to be kept forever, invisibly).
export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getTrashedPhotos(): Promise<Photo[]> {
  const db = await getDb();
  const trashed = await db.getAllFromIndex('photos', 'by-status', 'trashed');
  return trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

export function daysUntilPurge(photo: Photo, now = Date.now()): number {
  const since = photo.trashedAt ?? now;
  return Math.max(0, Math.ceil((since + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS));
}

export async function restorePhotos(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => updatePhotoStatus(id, 'kept')));
}

export async function deletePhotosForever(ids: string[]): Promise<void> {
  const db = await getDb();
  await Promise.all(ids.flatMap((id) => [db.delete('photos', id), db.delete('thumbs', id)]));
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
  const trashed = await db.getAllFromIndex('photos', 'by-status', 'trashed');
  let purged = 0;
  for (const photo of trashed) {
    if (photo.trashedAt == null) {
      await db.put('photos', { ...photo, trashedAt: now });
    } else if (now - photo.trashedAt >= TRASH_RETENTION_DAYS * DAY_MS) {
      await db.delete('photos', photo.id);
      await db.delete('thumbs', photo.id);
      purged++;
    }
  }
  return purged;
}

export async function setPhotoNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.note = note;
  await db.put('photos', photo);
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
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.isScreenshot = true;
  await db.put('photos', photo);
}

export async function getKeptPhotosWithoutAlbum(): Promise<Photo[]> {
  const db = await getDb();
  const kept = await db.getAllFromIndex('photos', 'by-status', 'kept');
  return kept.filter((p) => !p.albumId);
}

export async function assignPhotoToAlbum(id: string, albumId: string): Promise<void> {
  const db = await getDb();
  const photo = await db.get('photos', id);
  if (!photo) return;
  photo.albumId = albumId;
  photo.status = 'kept';
  await db.put('photos', photo);
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
  const photos = await db.getAllFromIndex('photos', 'by-album', id);
  const tx = db.transaction(['photos', 'albums'], 'readwrite');
  await Promise.all(photos.map((p) => tx.objectStore('photos').put({ ...p, albumId: null })));
  await tx.objectStore('albums').delete(id);
  await tx.done;
  return photos.length;
}

export async function getPhotosByAlbum(albumId: string): Promise<Photo[]> {
  const db = await getDb();
  return db.getAllFromIndex('photos', 'by-album', albumId);
}

export async function getPhotosByIds(ids: string[]): Promise<Photo[]> {
  const db = await getDb();
  const photos = await Promise.all(ids.map((id) => db.get('photos', id)));
  return photos.filter((p): p is Photo => Boolean(p));
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
    await db.put('photos', { ...photo, albumId });
    added++;
  }

  for (const person of people) {
    if (!(await db.getKey('people', person.id))) await db.put('people', person);
  }

  return { added, skipped, albums: newAlbums };
}
