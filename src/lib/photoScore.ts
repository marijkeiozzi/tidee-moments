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
}

// Raw sharpness (edge/texture density) is a poor stand-in for "best photo" — a background of
// rocks or foliage reads as sharper than a soft-focus close-up of a face, even though the face
// shot is obviously the keeper. Weight toward "has a person in it, facing the camera, eyes
// open, genuinely smiling, prominent in frame" first, and only fall back to sharpness as a
// tiebreaker within that. openEyesFraction/smileScore are continuous (not all-or-nothing) so a
// group photo where one of five people blinked doesn't get the same penalty as a solo portrait
// with closed eyes.
export function scorePhotoQuality(s: PhotoQualitySignals): number {
  let score = s.faceCount > 0 ? 1000 : 0;
  if (s.facingAway) score -= 400;
  score += s.openEyesFraction * 300;
  score += s.smileScore * 250;
  score += s.maxFaceArea * 200;
  score += Math.min(s.sharpness, 300);
  return score;
}
