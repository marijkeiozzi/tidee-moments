// Free, local detection of document/screenshot-like content — a receipt, form, whiteboard,
// printed page, or an app screenshot with UI chrome (buttons, avatars, text blocks) — as
// opposed to an ordinary photo. No AI, no API call.
//
// Pure documents have a distinctive fingerprint: a large, mostly desaturated (near-grayscale)
// bright background — the paper — with a meaningful amount of fine dark detail on top of it —
// the text/print. A composite app screenshot (e.g. a recipe card: a real photo up top, a block
// of white UI with text/buttons below) won't necessarily look that way across the WHOLE frame,
// so alongside the whole-frame check we also test the top and bottom halves independently —
// catching a flat, text-covered UI region even when the rest of the frame is a genuine photo.

const SAMPLE_SIZE = 120;
const MAX_AVG_SATURATION = 0.16;
const MIN_BRIGHT_FRACTION = 0.45;
const MIN_EDGE_VARIANCE = 40;
// The half-frame checks exist to catch a screenshot that's only document-like in part of the
// frame (a photo up top, a caption block below) — but an ordinary photo can also have one half
// dominated by something bright-and-flat (a window, a wall) or dark-and-flat (a t-shirt, hair),
// with enough incidental edges (window mullions, hair strands) to clear MIN_EDGE_VARIANCE. A
// genuine document/screenshot region is much more uniformly bright or dark than that, so the
// half-frame checks need a stricter fraction than the whole-frame ones (where requiring nearly
// the ENTIRE image to match is already a strong, low-false-positive signal on its own).
const MIN_BRIGHT_FRACTION_HALF_FRAME = 0.65;
const MIN_DARK_FRACTION_HALF_FRAME = 0.7;

// A previous version of this file also checked a thin strip at the very top/bottom edge for
// UI chrome (an avatar/username/"Follow" bar) with a looser saturation cap than the half-frame
// checks. Removed: a bright sky with clouds or a horizon line at the top of an ordinary outdoor
// photo has the exact same fingerprint — bright, fairly desaturated, with real edge detail —
// and it was misclassifying the majority of a real batch of outdoor family photos as
// screenshots. The half-frame checks below (which require the saturation cap across an entire
// half of the frame, not just a thin slice) are the more reliable version of this idea.

interface RegionStats {
  avgSaturation: number;
  brightFraction: number;
  darkFraction: number;
  edgeVariance: number;
}

function analyzeRegion(gray: Float32Array, sat: Float32Array, lightness: Float32Array, top: number, bottom: number): RegionStats {
  let satSum = 0;
  let brightCount = 0;
  let darkCount = 0;
  let count = 0;

  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      const idx = y * SAMPLE_SIZE + x;
      satSum += sat[idx];
      if (lightness[idx] > 0.75) brightCount++;
      if (lightness[idx] < 0.22) darkCount++;
      count++;
    }
  }

  let sum = 0;
  let sumSq = 0;
  let edgeCount = 0;
  const edgeTop = Math.max(top, 1);
  const edgeBottom = Math.min(bottom, SAMPLE_SIZE - 1);
  for (let y = edgeTop; y < edgeBottom; y++) {
    for (let x = 1; x < SAMPLE_SIZE - 1; x++) {
      const idx = y * SAMPLE_SIZE + x;
      const laplacian = gray[idx - SAMPLE_SIZE] + gray[idx + SAMPLE_SIZE] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      sum += laplacian;
      sumSq += laplacian * laplacian;
      edgeCount++;
    }
  }
  const mean = edgeCount > 0 ? sum / edgeCount : 0;
  const edgeVariance = edgeCount > 0 ? sumSq / edgeCount - mean * mean : 0;

  return {
    avgSaturation: satSum / count,
    brightFraction: brightCount / count,
    darkFraction: darkCount / count,
    edgeVariance,
  };
}

function looksLikeDocument(stats: RegionStats, minBrightFraction = MIN_BRIGHT_FRACTION): boolean {
  return (
    stats.avgSaturation < MAX_AVG_SATURATION &&
    stats.brightFraction > minBrightFraction &&
    stats.edgeVariance > MIN_EDGE_VARIANCE
  );
}

// Dark-mode app screenshots (Instagram/TikTok-style posts, dark-theme recipe cards) have the
// same "flat background + text/icons on top" fingerprint as a paper document, just inverted —
// mostly near-black instead of near-white, with light-colored text and UI glyphs providing the
// edge detail instead of dark print.
function looksLikeDarkDocument(stats: RegionStats, minDarkFraction: number): boolean {
  return (
    stats.avgSaturation < MAX_AVG_SATURATION &&
    stats.darkFraction > minDarkFraction &&
    stats.edgeVariance > MIN_EDGE_VARIANCE
  );
}

export async function detectDocumentLike(blob: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

      const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const pixelCount = SAMPLE_SIZE * SAMPLE_SIZE;
      const gray = new Float32Array(pixelCount);
      const sat = new Float32Array(pixelCount);
      const lightness = new Float32Array(pixelCount);

      for (let i = 0; i < pixelCount; i++) {
        const r = data[i * 4] / 255;
        const g = data[i * 4 + 1] / 255;
        const b = data[i * 4 + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        lightness[i] = l;
        sat[i] = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }

      const whole = analyzeRegion(gray, sat, lightness, 0, SAMPLE_SIZE);
      if (looksLikeDocument(whole) || looksLikeDarkDocument(whole, MIN_DARK_FRACTION_HALF_FRAME)) return true;

      const mid = Math.floor(SAMPLE_SIZE / 2);
      const topHalf = analyzeRegion(gray, sat, lightness, 0, mid);
      if (looksLikeDocument(topHalf, MIN_BRIGHT_FRACTION_HALF_FRAME) || looksLikeDarkDocument(topHalf, MIN_DARK_FRACTION_HALF_FRAME))
        return true;
      const bottomHalf = analyzeRegion(gray, sat, lightness, mid, SAMPLE_SIZE);
      if (
        looksLikeDocument(bottomHalf, MIN_BRIGHT_FRACTION_HALF_FRAME) ||
        looksLikeDarkDocument(bottomHalf, MIN_DARK_FRACTION_HALF_FRAME)
      )
        return true;

      return false;
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
  }
}
