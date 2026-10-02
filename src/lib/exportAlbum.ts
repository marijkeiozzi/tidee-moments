import JSZip from 'jszip';
import type { Photo } from '../db/indexedDb';

// Characters that are illegal (or path separators) in file names on Windows, macOS or inside
// a zip. An album called "Mila 1/2" or "Trip: day 1" would otherwise produce a broken file
// name or a stray folder inside the zip.
const ILLEGAL_CHARS = /[/\\?%*:|"<>\u0000-\u001f]/g;
const MAX_NAME_LENGTH = 80;

export function safeFileName(name: string, fallback = 'Photos'): string {
  const cleaned = name
    .replace(/[/\\]/g, '-')
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[. ]+$/, '');
  return cleaned || fallback;
}

// Saves a generated file. The link has to be in the document for Firefox, and the blob URL
// must outlive the click — revoking it immediately can cancel the download in Safari/Firefox.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function sortChronologically(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => a.capturedAt - b.capturedAt || a.createdAt - b.createdAt);
}

function extensionOf(type: string): string {
  const sub = type.split('/')[1]?.toLowerCase() ?? '';
  if (sub === 'jpeg' || sub === 'pjpeg' || sub === '') return 'jpg';
  return sub.replace(/[^a-z0-9]/g, '') || 'jpg';
}

// "007 Fishing with Dad.jpg" / "007 Mila's first year.jpg". The number keeps files in the
// order the photos were taken in any file browser or photo-book uploader that sorts by name.
export function exportFileName(photo: Photo, albumTitle: string, index: number, total: number, ext: string): string {
  const number = String(index + 1).padStart(Math.max(3, String(total).length), '0');
  const label = safeFileName(photo.note, '') || safeFileName(albumTitle);
  return `${number} ${label}.${ext}`;
}

// Zips are built in memory, so a library of thousands of photos is split into parts the
// browser can comfortably hold (and that most upload/email tools accept).
export const MAX_ZIP_PART_BYTES = 500 * 1024 * 1024;

export function planZipParts(photos: Photo[], maxBytes = MAX_ZIP_PART_BYTES): Photo[][] {
  const parts: Photo[][] = [];
  let current: Photo[] = [];
  let size = 0;
  for (const photo of photos) {
    const bytes = photo.blob.size;
    if (current.length > 0 && size + bytes > maxBytes) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(photo);
    size += bytes;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

export interface ZipExportProgress {
  done: number;
  total: number;
  part: number;
  parts: number;
}

export interface ZipExportResult {
  included: number;
  failed: number;
  parts: number;
}

// Exports the original files (never re-encoded, so full quality and camera metadata are kept),
// oldest first, each stamped with the date it was taken so unzipped files sort by date too.
export async function exportAlbumZip(
  title: string,
  photos: Photo[],
  onProgress?: (p: ZipExportProgress) => void,
  maxPartBytes = MAX_ZIP_PART_BYTES,
): Promise<ZipExportResult> {
  const ordered = sortChronologically(photos);
  const parts = planZipParts(ordered, maxPartBytes);
  const baseName = safeFileName(title);
  let included = 0;
  let failed = 0;
  let index = 0;

  for (let p = 0; p < parts.length; p++) {
    const zip = new JSZip();
    let inPart = 0;
    for (const photo of parts[p]) {
      try {
        const bytes = await photo.blob.arrayBuffer();
        const name = exportFileName(photo, title, index, ordered.length, extensionOf(photo.blob.type));
        zip.file(name, bytes, { date: new Date(photo.capturedAt), binary: true });
        included++;
        inPart++;
      } catch {
        failed++;
      }
      index++;
      onProgress?.({ done: index, total: ordered.length, part: p + 1, parts: parts.length });
    }
    if (inPart === 0) continue;
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(blob, parts.length > 1 ? `${baseName} (part ${p + 1} of ${parts.length}).zip` : `${baseName}.zip`);
  }

  return { included, failed, parts: parts.length };
}
