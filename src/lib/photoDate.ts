import { parse } from 'exifr';
import { detectDocumentLike } from './documentDetection';

export interface FileMeta {
  capturedAt: number;
  isScreenshot: boolean;
}

const SCREENSHOT_NAME_PATTERN = /screen[\s_-]?shot/i;

// Exact pixel resolutions (portrait, width x height) of common phone/tablet screens.
// A photo matching one of these exactly (in either orientation) is almost certainly
// a screen capture, not something shot with a camera sensor — this survives format
// conversion (PNG -> JPEG) and EXIF stripping that can happen when a photo is shared
// or exported off a device, unlike our other two signals.
const KNOWN_SCREEN_RESOLUTIONS = new Set([
  // iPhone
  '640x960', '640x1136', '750x1334', '828x1792', '1080x1920', '1125x2436', '1170x2532',
  '1179x2556', '1206x2622', '1242x2208', '1242x2688', '1284x2778', '1290x2796', '1320x2868',
  // iPad
  '1488x2266', '1620x2160', '1640x2360', '1668x2224', '1668x2388', '2048x2732',
  // Common Android
  '720x1280', '1080x2130', '1080x2160', '1080x2220', '1080x2246', '1080x2280', '1080x2310',
  '1080x2340', '1080x2400', '1080x2408', '1080x2412', '1200x1920', '1440x2560', '1440x2960',
  '1440x2992', '1440x3040', '1440x3088', '1440x3120', '1440x3168', '1440x3200', '1600x2560',
]);

async function getDimensionKey(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const key = `${Math.min(bitmap.width, bitmap.height)}x${Math.max(bitmap.width, bitmap.height)}`;
    bitmap.close();
    return key;
  } catch {
    return null;
  }
}

// Screenshots and downloaded/saved images (a product listing, a decor mockup, an app capture)
// are almost always PNG or JPEG with no camera EXIF; real camera/phone photos are almost always
// JPEG/HEIC WITH that metadata (Make/Model gets written by the camera hardware itself, not
// something a screenshot or a saved web image would ever carry). This catches screenshots of
// colorful content — a video game HUD, a product photo — that the pixel-based document detector
// below can't, since that detector only recognizes flat, mostly-monochrome UI (a receipt, a text
// thread), not an arbitrary screen capture. HEIC is excluded: it's near-universally genuine
// camera output, never something you'd screenshot or download in that format.
export async function getFileMeta(file: File): Promise<FileMeta> {
  let capturedAt = file.lastModified || Date.now();
  let hasCameraExif = false;

  try {
    const exif = await parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model'] });
    const date: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (date instanceof Date && !isNaN(date.getTime())) {
      capturedAt = date.getTime();
    }
    hasCameraExif = Boolean(exif?.Make || exif?.Model);
  } catch {
    // No/unreadable EXIF — fall through with defaults.
  }

  const nameMatches = SCREENSHOT_NAME_PATTERN.test(file.name);
  const formatMatches = (file.type === 'image/png' || file.type === 'image/jpeg') && !hasCameraExif;
  const dimensionKey = nameMatches || formatMatches ? null : await getDimensionKey(file);
  const dimensionMatches = dimensionKey !== null && KNOWN_SCREEN_RESOLUTIONS.has(dimensionKey);

  // None of the screenshot signals fired (real camera photo, not a screen capture) — check
  // whether it's a camera photo OF a document/page (receipt, form, recipe card) instead, so
  // those land in the same separate pile as true screenshots rather than the regular sort.
  const isDocumentPhoto =
    !nameMatches && !formatMatches && !dimensionMatches ? await detectDocumentLike(file) : false;

  return { capturedAt, isScreenshot: nameMatches || formatMatches || dimensionMatches || isDocumentPhoto };
}
