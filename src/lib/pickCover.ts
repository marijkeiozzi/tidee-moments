import type { Photo } from '../db/indexedDb';
import { analyzePhoto, qualitySignalsOf } from './photoAnalysis';
import { scorePhotoQuality } from './photoScore';

// Scoring every photo in a big album would be slow for something as lightweight as picking a
// cover thumbnail — sampling the first N (already roughly chronological) is plenty to find a
// good face-forward shot without noticeably delaying the album list.
const MAX_SAMPLED = 12;

// Free, local "best cover photo" pick for an album — same face/eyes/smile scoring used
// elsewhere, so an album's thumbnail is a clear, smiling, well-framed shot rather than
// whichever photo happened to be added first.
export async function pickCoverPhoto(photos: Photo[]): Promise<Photo | null> {
  if (photos.length === 0) return null;
  const sample = photos.slice(0, MAX_SAMPLED);

  const scored = await Promise.all(
    sample.map(async (photo) => {
      try {
        const analysis = await analyzePhoto(photo.blob, { fingerprint: false });
        return { photo, score: scorePhotoQuality(qualitySignalsOf(analysis)) };
      } catch {
        return { photo, score: 0 };
      }
    }),
  );

  return scored.reduce((best, c) => (c.score > best.score ? c : best)).photo;
}
