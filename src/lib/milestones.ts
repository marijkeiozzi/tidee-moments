import type { Photo } from '../db/indexedDb';
import { getAllAlbums, getPhotosByAlbum } from '../db/indexedDb';
import { suggestAlbumName } from './sessions';

// A day with way more photos than usual is almost always a party, trip, or event — no image
// understanding needed, just volume.
const LARGE_SESSION_MIN = 8;

const bigDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function distinctDays(photos: Photo[]): number {
  return new Set(photos.map((p) => dayKey(p.capturedAt))).size;
}

// Free, local milestone/birthday detection — it works off capture dates alone, never the
// pixels. Both rules only apply to a batch from a single day: a whole camera roll spanning
// months isn't "a big day", and it would trivially share a month/day with some old album.
//  1. Recurring date: if an existing single-event album (all its photos from one day) was shot
//     on this same month/day in an earlier year, this is almost certainly the same annual event
//     (a birthday, an anniversary) — reuse that album's name so it files the same way each year.
//  2. Unusual volume: a single day with lots of photos suggests something worth naming —
//     suggested as that day, marked as a big one, for the parent to rename.
// Anything else gets the plain date-range name ("July 2026", "Jul–Sep 2026").
export async function suggestMilestoneAlbumName(photos: Photo[]): Promise<string> {
  const fallback = suggestAlbumName(photos);
  if (photos.length === 0 || distinctDays(photos) !== 1) return fallback;

  const sample = new Date(photos[0].capturedAt);
  const albums = await getAllAlbums();

  for (const album of albums) {
    const albumPhotos = await getPhotosByAlbum(album.id);
    if (albumPhotos.length === 0 || distinctDays(albumPhotos) !== 1) continue;
    const d = new Date(albumPhotos[0].capturedAt);
    if (d.getMonth() === sample.getMonth() && d.getDate() === sample.getDate() && d.getFullYear() < sample.getFullYear()) {
      return album.name;
    }
  }

  if (photos.length >= LARGE_SESSION_MIN) {
    return `🎉 ${bigDayFormat.format(sample)} — a big day`;
  }

  return fallback;
}
