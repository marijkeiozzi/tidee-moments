// Browsers (Chrome, Firefox, Edge) can't decode HEIC/HEIF in <img>, <canvas>, or
// createImageBitmap — and HEIC is the default photo format on iPhone. Without this,
// every photo uploaded straight from an iPhone camera roll renders as a broken image.
export function isHeicFile(file: File): boolean {
  return isHeicBlob(file) || /\.hei[cf]$/i.test(file.name);
}

export function isHeicBlob(blob: Blob): boolean {
  return blob.type === 'image/heic' || blob.type === 'image/heif';
}

export async function convertHeicBlob(blob: Blob): Promise<Blob> {
  const heic2any = (await import('heic2any')).default;
  const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(result) ? result[0] : result;
}

export async function convertHeicIfNeeded(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  const blob = await convertHeicBlob(file);
  const newName = file.name.replace(/\.hei[cf]$/i, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
}
