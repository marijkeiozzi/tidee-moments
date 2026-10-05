import { isMobileDevice } from './concurrency';

// Getting a finished file (a zip export, a share page, a backup) to the person.
//
// Browsers only reliably allow a download that starts directly from the person's own click. A
// zip that takes seconds to build is no longer "from a click" by the time it's ready — iPhone
// Safari and Mac Safari then block the download silently, and some in-app browsers block
// script-started downloads altogether. So every finished file is shown in a small "Your file is
// ready" panel (FileReadySheet) with a real download link to click, plus a Share button on
// phones (Save to Files, AirDrop, Messages...).

export const FILE_READY_EVENT = 'tidee:file-ready';

export interface ReadyFile {
  file: File;
  label: string; // e.g. "Backup part 2 of 3"
}

export function deliverFile(blob: Blob, filename: string, label = filename) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  window.dispatchEvent(new CustomEvent<ReadyFile>(FILE_READY_EVENT, { detail: { file, label } }));
}

export function canShareFile(file: File): boolean {
  try {
    return isMobileDevice() && Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

// Must be called from a tap handler.
export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
