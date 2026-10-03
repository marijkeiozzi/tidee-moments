import type { Photo } from '../db/indexedDb';
import { getPhotosByIds } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';

// Grids show hundreds or thousands of photos. Handing each <img> the full-size original
// (12+ megapixels from a modern phone) makes the browser decode and hold all of them at once —
// Safari in particular runs out of image memory and starts showing a broken-image "?" for some.
// Instead, each visible tile gets a small JPEG made on demand, a few at a time.
const THUMB_MAX_SIDE = 480;
const MAX_CONCURRENT = 3;

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to decode'));
    img.src = url;
  });
}

async function shrink(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0; // let Safari release the canvas memory right away
    return thumb ?? blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Returns an object URL for a small version of the photo (the caller revokes it). If the
// in-memory copy can't be read — Safari can invalidate a Blob it handed out from IndexedDB —
// the photo is re-read fresh from storage before giving up.
export async function createThumbnailUrl(photo: Photo, { fresh = false } = {}): Promise<string> {
  return withSlot(async () => {
    let source = photo;
    if (fresh) {
      const [stored] = await getPhotosByIds([photo.id]);
      if (stored) source = stored;
    }
    const blob = await getDisplayableBlob(source);
    try {
      return URL.createObjectURL(await shrink(blob));
    } catch (err) {
      if (fresh) throw err;
      const [stored] = await getPhotosByIds([photo.id]);
      if (!stored) throw err;
      return URL.createObjectURL(await shrink(await getDisplayableBlob(stored)));
    }
  });
}
