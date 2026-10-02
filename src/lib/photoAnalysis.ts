// One-pass, on-device photo analysis — decodes each photo once and derives every pixel-level
// signal auto-sort needs from that single decode (previously blur, exposure, hash and document
// detection each decoded the full-resolution file separately). No AI, no API call.
//
// On top of the original whole-frame sharpness it measures:
//  - focusSharpness: how sharp the sharpest parts of the frame are. Whole-frame sharpness
//    reads a portrait-mode shot (sharp baby, deliberately blurred background) as "blurry",
//    which used to be enough to delete it; the sharpest regions tell "nothing is in focus"
//    apart from "the background is soft on purpose".
//  - per-face sharpness and brightness: whether the *face* is in focus and well lit, not just
//    the frame. A burst where the background is crisp but the baby moved, or a face in
//    shadow against a bright window, used to look fine on whole-frame numbers.
//  - a small colour thumbnail and a SHA-256 of the file, used to confirm duplicates (see
//    duplicateDetection.ts) and to recognise copies already in the library.
import { detectClosedEyes, type FaceBox, type FaceCheck } from './eyesClosed';
import { detectLowQuality, type QualityResult } from './qualityDetection';
import { computeImageHash } from './duplicateDetection';
import { detectDocumentLike } from './documentDetection';
import type { PhotoQualitySignals } from './photoScore';

// Whole-frame sharpness is the variance of the Laplacian (edge response) of a grayscale copy
// drawn at this size — the same measure and size the app has always used, so the sharpness
// thresholds in classifyPhoto.ts keep their meaning. Sharp photos have lots of fine detail
// (high variance); out-of-focus or motion-blurred ones are smooth (low variance).
const ANALYSIS_DIM = 300;
const BLUR_VARIANCE_THRESHOLD = 120;

// The frame is split into a TILE_GRID x TILE_GRID grid; focusSharpness is the sharpness of the
// FOCUS_RANK-th sharpest tile. Using the 4th-sharpest of 36 (top ~10% of the frame) instead of
// the single sharpest keeps one noisy or specular tile from vouching for a blurry photo.
const TILE_GRID = 6;
const FOCUS_RANK = 4;

// Faces smaller than this (in analysis pixels) are too small to judge focus or lighting on.
const MIN_FACE_PX = 14;

export const THUMB_SIZE = 24;

export interface FaceRegion extends FaceBox {
  sharpness: number;
  brightness: number; // mean luminance 0..255
}

export interface FaceSignals extends FaceCheck {
  // Sharpness of the sharpest face — null when there is no face big enough to measure.
  faceSharpness: number | null;
  // Brightness of the most prominent face, and of the frame as a whole, for backlight checks.
  faceBrightness: number | null;
  frameBrightness: number;
}

export interface PhotoFingerprint {
  sha256: string | null;
  dHash: string; // 64-bit dHash, hex
  thumb: Uint8Array; // THUMB_SIZE x THUMB_SIZE RGB, area-averaged
  width: number;
  height: number;
}

export interface PhotoAnalysis {
  sharpness: number;
  focusSharpness: number;
  // Fraction of the frame that is pure white / pure black — clipped detail that can't be
  // recovered. A mean-brightness check misses a photo that is half blown-out sky.
  clippedHighlights: number;
  clippedShadows: number;
  isBlurry: boolean;
  quality: QualityResult;
  hash: bigint | null;
  isDocument: boolean;
  face: FaceSignals;
  fingerprint: PhotoFingerprint | null;
}

interface PixelMaps {
  width: number;
  height: number;
  gray: Float32Array;
  lap: Float32Array; // Laplacian response, 0 on the 1px border
  rgba: Uint8ClampedArray;
}

function drawForAnalysis(bitmap: ImageBitmap): PixelMaps {
  const scale = Math.min(1, ANALYSIS_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  const lap = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      lap[idx] = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
    }
  }
  return { width, height, gray, lap, rgba };
}

// Variance of the Laplacian over [x0,x1) x [y0,y1), interior pixels only.
function lapVariance(m: PixelMaps, x0: number, y0: number, x1: number, y1: number): number {
  const xs = Math.max(1, x0);
  const ys = Math.max(1, y0);
  const xe = Math.min(m.width - 1, x1);
  const ye = Math.min(m.height - 1, y1);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const v = m.lap[y * m.width + x];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function meanGray(m: PixelMaps, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, y0); y < Math.min(m.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(m.width, x1); x++) {
      sum += m.gray[y * m.width + x];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function clippingOf(m: PixelMaps): { highlights: number; shadows: number } {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < m.gray.length; i++) {
    if (m.gray[i] >= 250) hi++;
    else if (m.gray[i] <= 5) lo++;
  }
  return { highlights: hi / m.gray.length, shadows: lo / m.gray.length };
}

function focusSharpnessOf(m: PixelMaps): number {
  const tiles: number[] = [];
  for (let ty = 0; ty < TILE_GRID; ty++) {
    for (let tx = 0; tx < TILE_GRID; tx++) {
      const x0 = Math.floor((tx * m.width) / TILE_GRID);
      const x1 = Math.floor(((tx + 1) * m.width) / TILE_GRID);
      const y0 = Math.floor((ty * m.height) / TILE_GRID);
      const y1 = Math.floor(((ty + 1) * m.height) / TILE_GRID);
      tiles.push(lapVariance(m, x0, y0, x1, y1));
    }
  }
  tiles.sort((a, b) => b - a);
  return tiles[Math.min(FOCUS_RANK, tiles.length) - 1];
}

// Inner part of a face box — the detector's box includes hair and background at the edges,
// whose high-contrast outlines would make a blurry face read as sharp.
function faceRegion(m: PixelMaps, box: FaceBox): FaceRegion | null {
  const x0 = Math.round((box.x + box.width * 0.15) * m.width);
  const x1 = Math.round((box.x + box.width * 0.85) * m.width);
  const y0 = Math.round((box.y + box.height * 0.15) * m.height);
  const y1 = Math.round((box.y + box.height * 0.85) * m.height);
  if (x1 - x0 < MIN_FACE_PX * 0.7 || y1 - y0 < MIN_FACE_PX * 0.7) return null;
  return { ...box, sharpness: lapVariance(m, x0, y0, x1, y1), brightness: meanGray(m, x0, y0, x1, y1) };
}

function thumbnailOf(m: PixelMaps): Uint8Array {
  const sums = new Float64Array(THUMB_SIZE * THUMB_SIZE * 3);
  const counts = new Uint32Array(THUMB_SIZE * THUMB_SIZE);
  for (let y = 0; y < m.height; y++) {
    const ty = Math.min(THUMB_SIZE - 1, Math.floor((y * THUMB_SIZE) / m.height));
    for (let x = 0; x < m.width; x++) {
      const tx = Math.min(THUMB_SIZE - 1, Math.floor((x * THUMB_SIZE) / m.width));
      const cell = ty * THUMB_SIZE + tx;
      const i = (y * m.width + x) * 4;
      sums[cell * 3] += m.rgba[i];
      sums[cell * 3 + 1] += m.rgba[i + 1];
      sums[cell * 3 + 2] += m.rgba[i + 2];
      counts[cell]++;
    }
  }
  const thumb = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 3);
  for (let c = 0; c < counts.length; c++) {
    const n = Math.max(1, counts[c]);
    thumb[c * 3] = Math.round(sums[c * 3] / n);
    thumb[c * 3 + 1] = Math.round(sums[c * 3 + 1] / n);
    thumb[c * 3 + 2] = Math.round(sums[c * 3 + 2] / n);
  }
  return thumb;
}

async function sha256Of(blob: Blob): Promise<string | null> {
  if (!crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const NO_FACE: FaceCheck = { eyesClosed: false, facingAway: false, faceCount: 0, openEyesFraction: 1, smileScore: 0, maxFaceArea: 0 };

export function faceSignalsFrom(face: FaceCheck, maps: PixelMaps | null): FaceSignals {
  const frameBrightness = maps ? meanGray(maps, 0, 0, maps.width, maps.height) : 128;
  if (!maps || !face.faceBoxes?.length) return { ...face, faceSharpness: null, faceBrightness: null, frameBrightness };
  const regions = face.faceBoxes.map((b) => faceRegion(maps, b)).filter((r): r is FaceRegion => r !== null);
  if (regions.length === 0) return { ...face, faceSharpness: null, faceBrightness: null, frameBrightness };
  const biggest = regions.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  return {
    ...face,
    faceSharpness: Math.max(...regions.map((r) => r.sharpness)),
    faceBrightness: biggest.brightness,
    frameBrightness,
  };
}

// What scorePhotoQuality() needs — shared so auto-sort, the burst picker and album covers all
// pick "the best shot" the same way.
export function qualitySignalsOf(a: PhotoAnalysis): PhotoQualitySignals {
  return { ...a.face, sharpness: a.sharpness };
}

// Full analysis used by auto-sort. Each individual check falls back to a neutral value on
// failure, so one unreadable signal never turns into a deletion.
export async function analyzePhoto(blob: Blob, opts: { faces?: boolean; fingerprint?: boolean } = {}): Promise<PhotoAnalysis> {
  const wantFaces = opts.faces ?? true;
  const wantFingerprint = opts.fingerprint ?? true;
  const bitmap = await createImageBitmap(blob);
  try {
    const maps = drawForAnalysis(bitmap);
    const sharpness = lapVariance(maps, 1, 1, maps.width - 1, maps.height - 1);
    const [quality, hash, isDocument, face, sha256] = await Promise.all([
      detectLowQuality(bitmap).catch(() => ({ isLowQuality: false }) as QualityResult),
      computeImageHash(bitmap).catch(() => null),
      detectDocumentLike(bitmap).catch(() => false),
      wantFaces ? detectClosedEyes(blob).catch(() => NO_FACE) : Promise.resolve(NO_FACE),
      wantFingerprint ? sha256Of(blob) : Promise.resolve(null),
    ]);
    const clipping = clippingOf(maps);
    return {
      sharpness,
      focusSharpness: focusSharpnessOf(maps),
      clippedHighlights: clipping.highlights,
      clippedShadows: clipping.shadows,
      isBlurry: sharpness < BLUR_VARIANCE_THRESHOLD,
      quality,
      hash,
      isDocument,
      face: faceSignalsFrom(face, maps),
      fingerprint:
        wantFingerprint && hash !== null
          ? { sha256, dHash: hash.toString(16), thumb: thumbnailOf(maps), width: bitmap.width, height: bitmap.height }
          : null,
    };
  } finally {
    bitmap.close();
  }
}
