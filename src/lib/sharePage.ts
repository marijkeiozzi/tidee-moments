import type { Photo } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { photoFilename } from './filename';

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

export async function buildShareablePage(albumName: string, photos: Photo[]): Promise<ShareablePageResult> {
  const results = await Promise.all(
    photos.map(async (photo) => {
      try {
        const dataUri = await getDisplayableBlob(photo).then(blobToDataUri);
        return { photo, dataUri };
      } catch {
        return { photo, dataUri: null };
      }
    }),
  );

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
          <a class="save-btn" href="${dataUri}" download="${filename}">⬇ Save</a>
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
