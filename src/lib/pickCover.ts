import type { Photo } from '../db/indexedDb';
import { detectBlur } from './blurDetection';
import { detectClosedEyes } from './eyesClosed';
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
        const [blur, face] = await Promise.all([
          detectBlur(photo.blob).catch(() => ({ isBlurry: false, sharpness: 0 })),
          detectClosedEyes(photo.blob).catch(() => ({
            eyesClosed: false,
            facingAway: false,
            faceCount: 0,
            openEyesFraction: 1,
            smileScore: 0,
            maxFaceArea: 0,
          })),
        ]);
        return { photo, score: scorePhotoQuality({ sharpness: blur.sharpness, ...face }) };
      } catch {
        return { photo, score: 0 };
      }
    }),
  );

  return scored.reduce((best, c) => (c.score > best.score ? c : best)).photo;
}
