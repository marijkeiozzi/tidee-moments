// Shared "how good a photo is" scoring, free and local — used both by auto-sort's group
// winner picking (autoSort.ts) and by the burst-review card (BurstCard.tsx) so both pick a
// "best of these near-identical shots" the same way, on-device, with no AI/API call.
export interface PhotoQualitySignals {
  sharpness: number;
  eyesClosed: boolean;
  facingAway: boolean;
  faceCount: number;
  openEyesFraction: number;
  smileScore: number;
  maxFaceArea: number;
  // From photoAnalysis.ts — optional, so callers with only the original signals still score
  // the same way they always did.
  faceSharpness?: number | null;
  faceBrightness?: number | null;
}

// Maps a Laplacian-variance sharpness onto 0..300 on a log scale (10 -> 0, 1000 -> 300). The
// old linear min(sharpness, 300) saturated at 300, so every reasonably sharp shot in a burst
// tied and the pick fell to face/smile alone; on a log scale "sharp" still beats "slightly
// soft" all the way up.
function sharpnessPoints(sharpness: number): number {
  return 300 * Math.max(0, Math.min(1, Math.log10(Math.max(sharpness, 1) / 10) / 2));
}

// Raw sharpness (edge/texture density) is a poor stand-in for "best photo" — a background of
// rocks or foliage reads as sharper than a soft-focus close-up of a face, even though the face
// shot is obviously the keeper. Weight toward "has a person in it, facing the camera, eyes
// open, genuinely smiling, prominent in frame" first, and only fall back to sharpness as a
// tiebreaker within that — measured on the face when there is one. openEyesFraction/smileScore are continuous (not all-or-nothing) so a
// group photo where one of five people blinked doesn't get the same penalty as a solo portrait
// with closed eyes.
export function scorePhotoQuality(s: PhotoQualitySignals): number {
  let score = s.faceCount > 0 ? 1000 : 0;
  if (s.facingAway) score -= 400;
  score += s.openEyesFraction * 300;
  score += s.smileScore * 250;
  score += s.maxFaceArea * 200;
  if (s.faceSharpness != null) {
    // Judge focus on the face itself — the shot where the baby is sharp beats the one where
    // the background is sharp and the baby moved.
    score += sharpnessPoints(s.faceSharpness);
  } else if (s.faceSharpness === undefined) {
    score += Math.min(s.sharpness, 300);
  } else {
    score += sharpnessPoints(s.sharpness);
  }
  // A face lost in shadow (backlit by a window) or blown out is a worse keepsake than the same
  // moment with the face properly lit.
  if (s.faceBrightness != null) {
    if (s.faceBrightness < 90) score -= Math.min(150, (90 - s.faceBrightness) * 3);
    else if (s.faceBrightness > 235) score -= 100;
  }
  return score;
}
