import JSZip from 'jszip';
import { deliverFile } from './saveFile';
import type { Album, Person, Photo } from '../db/indexedDb';
import { getAllAlbums, getAllPeople, getAllPhotos, getPhotosByIds, importLibraryRecords } from '../db/indexedDb';

// Everything Tidee Moments knows lives only in this browser's storage, which the browser can
// clear (Safari after a week or so without a visit, or "clear website data"). A backup is a
// set of plain .zip files the parent keeps — photos in their original form plus a manifest
// with albums, captions, statuses and people's names — and can be restored on any browser.

export const BACKUP_FORMAT = 'tidee-moments-backup';
export const BACKUP_VERSION = 1;
// A browser has to hold a whole zip in memory while building it, so a big library is split
// into several files instead of one huge one that could crash the tab.
const MAX_PART_BYTES = 400 * 1024 * 1024;

export interface BackupPhotoEntry extends Omit<Photo, 'blob'> {
  file: string;
  type: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  part: number;
  parts: number;
  albums: Album[];
  people: Person[];
  photos: BackupPhotoEntry[];
}

const LAST_BACKUP_KEY = 'tidee:lastBackup';

export interface LastBackup {
  at: number;
  photoCount: number;
  // Kept photos included — what the reminder compares against.
  keptCount?: number;
}

// Fired after a backup so any reminder on screen can update straight away.
export const BACKUP_EVENT = 'tidee:backup-complete';

export function getLastBackup(): LastBackup | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    return raw ? (JSON.parse(raw) as LastBackup) : null;
  } catch {
    return null;
  }
}

function setLastBackup(info: LastBackup) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(info));
  } catch {
    // Storage blocked — the reminder will just show again.
  }
  window.dispatchEvent(new Event(BACKUP_EVENT));
}

function extensionFor(type: string): string {
  const sub = type.split('/')[1] ?? '';
  if (sub === 'jpeg') return 'jpg';
  return sub.replace(/[^a-z0-9]/gi, '') || 'jpg';
}

// Safari can invalidate a Blob it handed out from IndexedDB; re-read it fresh before giving up.
async function readPhotoBytes(photo: Photo): Promise<ArrayBuffer> {
  try {
    return await photo.blob.arrayBuffer();
  } catch {
    const [fresh] = await getPhotosByIds([photo.id]);
    if (!fresh) throw new Error('Photo no longer stored');
    return fresh.blob.arrayBuffer();
  }
}

export interface BackupResult {
  photos: number;
  failed: number;
  parts: number;
}

export async function createBackup(onProgress: (done: number, total: number) => void): Promise<BackupResult> {
  const [allPhotos, albums, people] = await Promise.all([getAllPhotos(), getAllAlbums(), getAllPeople()]);
  // Everything except Recently Deleted, which is on its way out anyway.
  const photos = allPhotos.filter((p) => p.status !== 'trashed').sort((a, b) => a.capturedAt - b.capturedAt);

  // Plan the parts up front from blob sizes, so each file says "part 2 of 3".
  const plan: Photo[][] = [[]];
  let size = 0;
  for (const photo of photos) {
    if (size > 0 && size + photo.blob.size > MAX_PART_BYTES) {
      plan.push([]);
      size = 0;
    }
    plan[plan.length - 1].push(photo);
    size += photo.blob.size;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const exportedAt = Date.now();
  let done = 0;
  let failed = 0;
  onProgress(0, photos.length);

  for (let i = 0; i < plan.length; i++) {
    const zip = new JSZip();
    const entries: BackupPhotoEntry[] = [];
    for (const photo of plan[i]) {
      try {
        const bytes = await readPhotoBytes(photo);
        const type = photo.blob.type || 'image/jpeg';
        const file = `photos/${photo.id}.${extensionFor(type)}`;
        zip.file(file, bytes, { binary: true });
        const { blob: _blob, ...meta } = photo;
        entries.push({ ...meta, file, type });
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === photos.length) onProgress(done, photos.length);
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      part: i + 1,
      parts: plan.length,
      albums,
      people,
      photos: entries,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 1));
    // Photos are already compressed — storing them as-is is much faster and no bigger.
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const suffix = plan.length > 1 ? `-part${i + 1}of${plan.length}` : '';
    deliverFile(
      blob,
      `tidee-moments-backup-${stamp}${suffix}.zip`,
      plan.length > 1 ? `Backup part ${i + 1} of ${plan.length}` : 'Your backup',
    );
  }

  setLastBackup({
    at: exportedAt,
    photoCount: photos.length - failed,
    keptCount: photos.filter((p) => p.status === 'kept').length,
  });
  return { photos: photos.length - failed, failed, parts: plan.length };
}

export interface RestoreResult {
  added: number;
  skipped: number;
  failed: number;
  albums: number;
}

export async function restoreBackup(files: File[], onProgress: (done: number, total: number) => void): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, skipped: 0, failed: 0, albums: 0 };
  let done = 0;
  let total = 0;

  for (const file of files) {
    let zip: JSZip;
    let manifest: BackupManifest;
    try {
      zip = await JSZip.loadAsync(file);
      const raw = await zip.file('manifest.json')?.async('string');
      if (!raw) throw new Error('missing manifest');
      manifest = JSON.parse(raw) as BackupManifest;
      if (manifest.format !== BACKUP_FORMAT) throw new Error('not a backup');
    } catch {
      throw new Error(`"${file.name}" isn't a Tidee Moments backup file.`);
    }
    if (manifest.version > BACKUP_VERSION) {
      throw new Error(`"${file.name}" was made by a newer version of Tidee Moments — reload the page and try again.`);
    }

    total += manifest.photos.length;
    onProgress(done, total);
    const photos: Photo[] = [];
    for (const entry of manifest.photos) {
      try {
        const bytes = await zip.file(entry.file)?.async('arraybuffer');
        if (!bytes) throw new Error('missing photo');
        const { file: _file, type, ...meta } = entry;
        photos.push({ ...meta, blob: new Blob([bytes], { type }) });
      } catch {
        result.failed++;
      }
      done++;
      if (done % 10 === 0 || done === total) onProgress(done, total);
    }
    const r = await importLibraryRecords(photos, manifest.albums, manifest.people);
    result.added += r.added;
    result.skipped += r.skipped;
    result.albums += r.albums;
  }
  return result;
}
