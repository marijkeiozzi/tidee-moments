// Free, local quality detection — no AI/API call. Catches the two most common "low quality"
// problems a formula can reliably judge: exposure (too dark/too bright) and resolution
// (too small to be a real photo, e.g. a thumbnail or icon that snuck into the camera roll).
// It can't judge composition or "is this a good shot" — that nuance is Claude's job.

const MIN_DIMENSION = 400;
const DARK_LUMINANCE_THRESHOLD = 25;
const BRIGHT_LUMINANCE_THRESHOLD = 235;
const SAMPLE_SIZE = 100;

export interface QualityResult {
  isLowQuality: boolean;
  reason?: 'low-resolution' | 'too-dark' | 'overexposed';
}

export async function detectLowQuality(blob: Blob): Promise<QualityResult> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < MIN_DIMENSION || bitmap.height < MIN_DIMENSION) {
      return { isLowQuality: true, reason: 'low-resolution' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    let sum = 0;
    const pixelCount = SAMPLE_SIZE * SAMPLE_SIZE;
    for (let i = 0; i < pixelCount; i++) {
      sum += 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    const avgLuminance = sum / pixelCount;

    if (avgLuminance < DARK_LUMINANCE_THRESHOLD) return { isLowQuality: true, reason: 'too-dark' };
    if (avgLuminance > BRIGHT_LUMINANCE_THRESHOLD) return { isLowQuality: true, reason: 'overexposed' };

    return { isLowQuality: false };
  } finally {
    bitmap.close();
  }
}
