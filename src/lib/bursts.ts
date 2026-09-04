import type { Photo } from '../db/indexedDb';

export interface PhotoBurst {
  id: string;
  photoIds: string[];
}

// A deliberate multi-shot sequence ("smile... okay one more... let's get another") usually has
// pauses between frames to check the screen and re-pose — often well past a rapid-fire burst's
// sub-second cadence, but still clearly one photo op, not a separate outing. 30s comfortably
// covers that without reaching into "wandered off and came back" territory.
const BURST_GAP_MS = 30 * 1000;
const MIN_BURST_SIZE = 2;
// A chain of consecutive close-together shots is capped here — without this, a long photo
// session (a whole fishing trip, dozens of candid shots a few seconds apart) chains into one
// giant group and gets reduced to a single "sharpest" survivor, wiping out everything else.
// A real rapid-fire burst (the same instant, caught 3-6 times) is well under this size.
const MAX_BURST_SIZE = 6;

// Clusters of 2+ shots taken within ~30s of each other — almost always the same near-identical
// moment (someone snapping a couple of frames to catch a smile, a jump, a shot of the fish
// tank, etc). A pair counts too — most people don't fire off three-plus shots for a casual
// re-take. Capped at MAX_BURST_SIZE so an extended session never collapses to one photo.
export function groupIntoBursts(photos: Photo[]): PhotoBurst[] {
  const realPhotos = photos.filter((p) => !p.isScreenshot);
  if (realPhotos.length === 0) return [];

  const sorted = [...realPhotos].sort((a, b) => a.capturedAt - b.capturedAt);
  const bursts: PhotoBurst[] = [];
  let current: Photo[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].capturedAt - sorted[i - 1].capturedAt;
    if (gap <= BURST_GAP_MS && current.length < MAX_BURST_SIZE) {
      current.push(sorted[i]);
    } else {
      if (current.length >= MIN_BURST_SIZE) bursts.push(buildBurst(current));
      current = [sorted[i]];
    }
  }
  if (current.length >= MIN_BURST_SIZE) bursts.push(buildBurst(current));

  return bursts;
}

function buildBurst(photos: Photo[]): PhotoBurst {
  return {
    id: `burst-${photos[0].capturedAt}`,
    photoIds: photos.map((p) => p.id),
  };
}
