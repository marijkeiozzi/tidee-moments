import type { Photo } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { photoFilename } from './filename';
import { mapWithConcurrency, pickPhotoConcurrency } from './concurrency';

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface ShareablePageResult {
  blob: Blob;
  included: number;
  failed: number;
}

// The page is one file meant to be texted or emailed to family, so its photos are sized for
// screens, not printing: full camera originals made a 7-photo page 57 MB. 2048px on the long
// side still looks sharp on any phone, tablet or laptop and saves fine; "Export zip" is the way
// to hand over full-size originals.
const SHARE_MAX_SIDE = 2048;

async function resizeForSharing(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, SHARE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && blob.type === 'image/jpeg') return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    canvas.width = canvas.height = 0;
    return out ?? blob;
  } finally {
    bitmap.close();
  }
}

export async function buildShareablePage(albumName: string, photos: Photo[]): Promise<ShareablePageResult> {
  // A couple at a time — each one is a full-size decode, and a whole album at once ran phones
  // out of memory.
  const results = await mapWithConcurrency(photos, pickPhotoConcurrency(), async (photo) => {
    try {
      const dataUri = await getDisplayableBlob(photo).then(resizeForSharing).then(blobToDataUri);
      return { photo, dataUri };
    } catch {
      return { photo, dataUri: null };
    }
  });

  const usable = results.filter((r): r is { photo: Photo; dataUri: string } => r.dataUri !== null);
  const failed = results.length - usable.length;

  const usedNames = new Set<string>();
  const cards = usable
    .map(({ photo, dataUri }, i) => {
      const caption = photo.note.trim();
      const ext = dataUri.slice(5, dataUri.indexOf(';')).split('/')[1] || 'jpg';
      let rawName = photoFilename(photo.note, albumName, i + 1, ext);
      let suffix = 2;
      while (usedNames.has(rawName)) {
        rawName = photoFilename(`${photo.note} (${suffix})`, albumName, i + 1, ext);
        suffix++;
      }
      usedNames.add(rawName);
      const filename = escapeHtml(rawName);
      return `
        <figure>
          <img src="${dataUri}" alt="" loading="lazy" />
          ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}
          <a class="save-btn" href="#" download="${filename}" onclick="this.href=this.parentNode.querySelector('img').src">⬇ Save</a>
        </figure>`;
    })
    .join('\n');

  const title = escapeHtml(albumName);

  const blob = new Blob(
    [
      `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} — Tidee Moments</title>
<style>
  body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f3ff; color: #292524; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  p.subtitle { color: #78716c; margin: 0 0 24px; font-size: 0.875rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; max-width: 1000px; margin: 0 auto; }
  figure { margin: 0; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  img { width: 100%; display: block; aspect-ratio: 1; object-fit: cover; }
  figcaption { padding: 8px 12px 0; font-size: 0.8rem; color: #57534e; }
  .save-btn { display: block; margin: 8px 12px 12px; padding: 6px 0; text-align: center; font-size: 0.8rem; font-weight: 600; color: white; background: #fb7185; border-radius: 999px; text-decoration: none; }
  .save-btn:active { background: #f43f5e; }
  .save-all { display: block; width: fit-content; margin: 0 auto 24px; padding: 10px 20px; font-size: 0.9rem; font-weight: 700; color: white; background: #fb7185; border: none; border-radius: 999px; cursor: pointer; }
</style>
</head>
<body>
  <h1>📁 ${title}</h1>
  <p class="subtitle">${usable.length} photo${usable.length === 1 ? '' : 's'} · shared from Tidee Moments</p>
  <button class="save-all" onclick="document.querySelectorAll('.save-btn').forEach((a,i)=>setTimeout(()=>a.click(),i*150))">⬇ Save all ${usable.length} photos</button>
  <p class="subtitle" style="text-align:center;margin-top:-16px">Or tap "⬇ Save" under any single photo below</p>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`,
    ],
    { type: 'text/html' },
  );

  return { blob, included: usable.length, failed };
}
