import { BLUR_SAMPLE_SIDE, withAnalysisImage, type AnalysisImage } from './analysisImage';
// Free, local blur detection — no AI/API call, runs entirely in the browser.
// Measures the variance of the Laplacian (edge response) of a downscaled grayscale copy
// of the photo. Sharp photos have lots of high-frequency detail (high variance); blurry
// or out-of-focus photos are smooth (low variance). This is a standard, decades-old
// computer-vision technique — not as nuanced as a vision model (it can't tell you eyes
// are closed or judge composition), but it catches genuinely out-of-focus/motion-blurred
// shots reliably at zero cost.

const BLUR_VARIANCE_THRESHOLD = 120;

export interface BlurResult {
  isBlurry: boolean;
  sharpness: number;
}

export async function detectBlur(input: Blob | AnalysisImage): Promise<BlurResult> {
  return withAnalysisImage(input, (image) => {
    // Pre-scaled to BLUR_SAMPLE_SIDE straight from the original (see analysisImage.ts).
    const { width, height } = image.blurSample;
    const ctx = image.blurSample.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;

    return { isBlurry: variance < BLUR_VARIANCE_THRESHOLD, sharpness: variance };
  });
}
