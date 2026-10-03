import { isMobileDevice } from './concurrency';

// Getting a finished file (a zip export, a share page, a backup) to the person.
//
// Computers: a normal download, started straight away.
// Phones: iPhone Safari only allows a download or the share sheet straight from a tap — after
// seconds of building a zip, the original tap no longer counts and the download is silently
// blocked (that's why "Export zip" did nothing on iPhone). So on phones the file is handed to a
// small "Your file is ready" sheet, and tapping its button (a fresh tap) opens the share sheet:
// Save to Files, AirDrop, Messages, Mail...

export const FILE_READY_EVENT = 'tidee:file-ready';

export interface ReadyFile {
  file: File;
  label: string; // e.g. "Backup part 2 of 3"
}

export function downloadNow(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away can cancel the download before the browser has started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function deliverFile(blob: Blob, filename: string, label = filename) {
  if (!isMobileDevice()) {
    downloadNow(blob, filename);
    return;
  }
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  window.dispatchEvent(new CustomEvent<ReadyFile>(FILE_READY_EVENT, { detail: { file, label } }));
}

// Must be called from a tap handler.
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Share failed for another reason — fall back to a plain download below.
    }
  }
  downloadNow(file, file.name);
  return 'downloaded';
}
