// Every check in the sort (blur, exposure, duplicates, documents, faces, scene) used to decode
// the full-size original on its own — six full decodes of a 12-megapixel photo, several photos
// at a time. On an iPhone that's hundreds of MB at once and the page stalls or gets killed.
// Instead each photo is decoded ONCE into a small working copy every check shares.

// Big enough for face landmarks on a group photo (the face detector itself works at 416px),
// small enough to hold a few at once on a phone.
const MAX_SIDE = 800;

export interface AnalysisImage {
  canvas: HTMLCanvasElement;
  width: number; // working-copy size
  height: number;
  naturalWidth: number; // original photo size
  naturalHeight: number;
  // The blur check's sample, scaled straight from the full-size photo in one step. Its
  // thresholds were tuned on exactly that; going full -> 800px -> 300px would come out a
  // little softer and could tip borderline photos into "blurry".
  blurSample: HTMLCanvasElement;
}

export const BLUR_SAMPLE_SIDE = 300;

function scaledCanvas(source: CanvasImageSource, srcW: number, srcH: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function decodeForAnalysis(blob: Blob): Promise<AnalysisImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = scaledCanvas(bitmap, bitmap.width, bitmap.height, MAX_SIDE);
    const blurSample = scaledCanvas(bitmap, bitmap.width, bitmap.height, BLUR_SAMPLE_SIDE);
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      naturalWidth: bitmap.width,
      naturalHeight: bitmap.height,
      blurSample,
    };
  } finally {
    bitmap.close();
  }
}

// Safari keeps canvas memory around until the canvas is shrunk; do it as soon as we're done.
export function releaseAnalysisImage(image: AnalysisImage) {
  for (const c of [image.canvas, image.blurSample]) {
    c.width = 0;
    c.height = 0;
  }
}

// Lets each detector accept either an already-decoded working copy (the fast path used by the
// sort) or a plain Blob (one-off callers like the album cover picker).
export async function withAnalysisImage<T>(input: Blob | AnalysisImage, fn: (image: AnalysisImage) => Promise<T> | T): Promise<T> {
  if (!(input instanceof Blob)) return fn(input);
  const image = await decodeForAnalysis(input);
  try {
    return await fn(image);
  } finally {
    releaseAnalysisImage(image);
  }
}

// Draw the working copy at a given size and read its pixels.
export function samplePixels(image: AnalysisImage, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(image.canvas, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

// A small JPEG for grid previews, made from the working copy while it's already decoded — so
// the review screen and timeline never have to decode full-size originals just to show a tile.
const THUMB_MAX_SIDE = 400;

export function makeThumbnail(image: AnalysisImage): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((b) => {
      canvas.width = canvas.height = 0;
      resolve(b);
    }, 'image/jpeg', 0.82),
  );
}
