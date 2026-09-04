import type { Photo } from '../db/indexedDb';
import { getAllAlbums, getPhotosByAlbum } from '../db/indexedDb';
import { suggestAlbumName } from './sessions';

// A day with way more photos than usual is almost always a party, trip, or event — no image
// understanding needed, just volume.
const LARGE_SESSION_MIN = 8;

// Free, local milestone/birthday detection — no AI, no image analysis. It works off two
// signals that don't require "seeing" the photo at all:
//  1. Recurring date: if an existing album's photos were taken on this same month/day in a
//     past year, this batch is almost certainly the same annual event (a birthday, an
//     anniversary) — reuse that album's exact name so it auto-files into the same album
//     year after year.
//  2. Unusual volume: a day with far more photos than a typical day suggests something
//     noteworthy happened, even if we can't say what — flagged for the parent to name.
export async function suggestMilestoneAlbumName(photos: Photo[]): Promise<string> {
  const fallback = suggestAlbumName(photos);
  if (photos.length === 0) return fallback;

  const sample = new Date(photos[0].capturedAt);
  const albums = await getAllAlbums();

  for (const album of albums) {
    const albumPhotos = await getPhotosByAlbum(album.id);
    const recurs = albumPhotos.some((p) => {
      const d = new Date(p.capturedAt);
      return (
        d.getMonth() === sample.getMonth() && d.getDate() === sample.getDate() && d.getFullYear() !== sample.getFullYear()
      );
    });
    if (recurs) return album.name;
  }

  if (photos.length >= LARGE_SESSION_MIN) {
    return `🎉 ${fallback} — looks like a big day`;
  }

  return fallback;
}
