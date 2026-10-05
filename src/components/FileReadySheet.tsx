import { useEffect, useMemo, useState } from 'react';
import { canShareFile, FILE_READY_EVENT, shareFile, type ReadyFile } from '../lib/saveFile';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Offers every finished export, share page or backup (see lib/saveFile.ts) with a real
// download link the person clicks themselves — the one kind of download every browser allows —
// and, on phones, a Share button. Several files (a backup in parts) are offered one by one.
export default function FileReadySheet() {
  const [queue, setQueue] = useState<ReadyFile[]>([]);
  const [saved, setSaved] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  useEffect(() => {
    const onReady = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<ReadyFile>).detail]);
    window.addEventListener(FILE_READY_EVENT, onReady);
    return () => window.removeEventListener(FILE_READY_EVENT, onReady);
  }, []);

  const current = queue[0];
  const url = useMemo(() => (current ? URL.createObjectURL(current.file) : null), [current]);
  // Kept alive while the panel is open (revoking early cancels a download in progress), and a
  // little after, so a download started just before closing still completes.
  useEffect(() => {
    if (!url) return;
    return () => {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [url]);

  if (!current || !url) return null;
  const shareable = canShareFile(current.file);

  function next() {
    setSaved(false);
    setShareFailed(false);
    setQueue((q) => q.slice(1));
  }

  async function handleShare() {
    const outcome = await shareFile(current.file);
    if (outcome === 'shared') next();
    if (outcome === 'failed') setShareFailed(true);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm bg-[#FBF8F2] rounded-3xl p-6 shadow-xl text-[#231F1B]">
        <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Your file is ready</p>
        <h2 className="font-serif text-2xl mb-1">{current.label}</h2>
        <p className="text-sm text-[#8A8177] mb-5 break-all">
          {current.file.name} · {formatSize(current.file.size)}
        </p>

        {shareable && (
          <button
            onClick={handleShare}
            className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors mb-2"
          >
            Save or share
          </button>
        )}
        <a
          href={url}
          download={current.file.name}
          onClick={() => setSaved(true)}
          className={`block w-full text-center font-medium py-3.5 rounded-full transition-colors ${
            shareable
              ? 'bg-white border border-black/10 text-[#231F1B] hover:bg-[#F6F1E7]'
              : 'bg-[#231F1B] hover:bg-black text-white'
          }`}
        >
          Download
        </a>

        <p className="text-xs text-[#8A8177] mt-3 text-center">
          {shareable ? (
            <>
              Choose <strong>Save to Files</strong> to keep it on your phone or in iCloud Drive.
            </>
          ) : saved ? (
            'Downloading — check your Downloads folder.'
          ) : (
            'Saves to your Downloads folder.'
          )}
          {queue.length > 1 ? ` ${queue.length - 1} more file${queue.length === 2 ? '' : 's'} after this one.` : ''}
        </p>
        {shareFailed && (
          <p className="text-xs text-amber-800 mt-2 text-center">Sharing didn't work here — use Download instead.</p>
        )}
        <p className="text-[11px] text-[#A69C8E] mt-3 text-center">
          Nothing happening? You may be in an app's built-in browser — open this site in Safari or Chrome instead.
        </p>

        <button onClick={next} className="w-full text-sm text-[#8A8177] hover:text-[#231F1B] mt-3">
          {saved ? 'Done' : 'Close'}
        </button>
      </div>
    </div>
  );
}
