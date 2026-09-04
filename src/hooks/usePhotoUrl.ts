import { useEffect, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { fixPhotoBlob } from '../db/indexedDb';
import { isHeicBlob, convertHeicBlob } from '../lib/heicConvert';

// Repairs photos saved before HEIC conversion existed: if the stored blob is still
// raw HEIC, convert it on first display and persist the fix so it only happens once.
export async function getDisplayableBlob(photo: Photo): Promise<Blob> {
  if (!isHeicBlob(photo.blob)) return photo.blob;
  try {
    const converted = await convertHeicBlob(photo.blob);
    fixPhotoBlob(photo.id, converted);
    return converted;
  } catch {
    return photo.blob;
  }
}

export function usePhotoUrl(photo: Photo | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    getDisplayableBlob(photo).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo?.id, photo?.blob]);

  return url;
}
