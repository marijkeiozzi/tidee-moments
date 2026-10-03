import { useEffect, useState } from 'react';
import { FILE_READY_EVENT, shareOrDownload, type ReadyFile } from '../lib/saveFile';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Phones only (see lib/saveFile.ts): when an export, share page or backup is ready, this sheet
// offers it with a button — a fresh tap, which iPhone Safari requires before it will open the
// share sheet or start a download. Several files (a backup in parts) are offered one by one.
export default function FileReadySheet() {
  const [queue, setQueue] = useState<ReadyFile[]>([]);

  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<ReadyFile>).detail;
      setQueue((q) => [...q, detail]);
    };
    window.addEventListener(FILE_READY_EVENT, onReady);
    return () => window.removeEventListener(FILE_READY_EVENT, onReady);
  }, []);

  const current = queue[0];
  if (!current) return null;

  async function handleSave() {
    const outcome = await shareOrDownload(current.file);
    if (outcome === 'cancelled') return; // keep it offered
    setQueue((q) => q.slice(1));
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#FBF8F2] rounded-3xl p-6 shadow-xl text-[#231F1B]">
        <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Ready</p>
        <h2 className="font-serif text-2xl mb-1">{current.label}</h2>
        <p className="text-sm text-[#8A8177] mb-5 break-all">
          {current.file.name} · {formatSize(current.file.size)}
        </p>
        <button
          onClick={handleSave}
          className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors"
        >
          Save or share
        </button>
        <p className="text-xs text-[#8A8177] mt-3 text-center">
          Choose <strong>Save to Files</strong> to keep it on your phone or in iCloud Drive.
          {queue.length > 1 ? ` ${queue.length - 1} more file${queue.length === 2 ? '' : 's'} after this one.` : ''}
        </p>
        <button
          onClick={() => setQueue((q) => q.slice(1))}
          className="w-full text-sm text-[#8A8177] hover:text-[#231F1B] mt-3"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
