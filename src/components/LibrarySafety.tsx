import { useEffect, useRef, useState } from 'react';
import { getTrashedPhotos } from '../db/indexedDb';
import { createBackup, getLastBackup, restoreBackup } from '../lib/backup';

interface LibrarySafetyProps {
  onOpenRecentlyDeleted: () => void;
  onRestored: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

// The "your photos are safe" panel on the Albums tab: back up, restore, see how much space is
// used, whether the browser has promised to keep it, and get to Recently Deleted.
export default function LibrarySafety({ onOpenRecentlyDeleted, onRestored }: LibrarySafetyProps) {
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [trashCount, setTrashCount] = useState(0);
  const [lastBackup, setLastBackupState] = useState(getLastBackup());
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage != null && est.quota) setUsage({ used: est.usage, quota: est.quota });
    } catch {
      // Not supported — the line is just hidden.
    }
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      setPersisted(null);
    }
    setTrashCount((await getTrashedPhotos()).length);
    setLastBackupState(getLastBackup());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleBackup() {
    setMessage(null);
    setProgress({ label: 'Preparing backup', done: 0, total: 0 });
    try {
      const r = await createBackup((done, total) => setProgress({ label: 'Packing photos', done, total }));
      setMessage({
        tone: r.failed > 0 ? 'warn' : 'ok',
        text:
          `Backup downloaded — ${r.photos} photo${r.photos === 1 ? '' : 's'}` +
          (r.parts > 1 ? ` in ${r.parts} files (keep all of them together)` : '') +
          '. Save it somewhere safe, like iCloud Drive, Google Drive or a computer.' +
          (r.failed > 0 ? ` ${r.failed} photo${r.failed === 1 ? '' : 's'} couldn't be read and were left out.` : ''),
      });
    } catch (err) {
      setMessage({ tone: 'warn', text: `Backup failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setProgress(null);
      refresh();
    }
  }

  async function handleRestore(files: File[]) {
    if (files.length === 0) return;
    setMessage(null);
    setProgress({ label: 'Reading backup', done: 0, total: 0 });
    try {
      const r = await restoreBackup(files, (done, total) => setProgress({ label: 'Restoring photos', done, total }));
      setMessage({
        tone: r.failed > 0 ? 'warn' : 'ok',
        text:
          `Restored ${r.added} photo${r.added === 1 ? '' : 's'}` +
          (r.albums > 0 ? ` and ${r.albums} album${r.albums === 1 ? '' : 's'}` : '') +
          (r.skipped > 0 ? ` · ${r.skipped} were already here` : '') +
          (r.failed > 0 ? ` · ${r.failed} couldn't be read` : '') +
          '.',
      });
      onRestored();
    } catch (err) {
      setMessage({ tone: 'warn', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setProgress(null);
      if (restoreInput.current) restoreInput.current.value = '';
      refresh();
    }
  }

  const showHomeScreenTip = isIosBrowserTab();

  return (
    <section className="mt-12 bg-white border border-black/5 rounded-2xl p-5 sm:p-6">
      <h2 className="font-serif text-2xl mb-1">Keep your photos safe</h2>
      <p className="text-sm text-[#7A7266] mb-4 max-w-2xl">
        Everything here is stored only in this browser — nothing is uploaded. Browsers can clear website data (for example
        Safari after a few weeks without a visit, or when you clear your history), so download a backup now and then. You
        can restore it on any device.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleBackup}
          disabled={progress !== null}
          className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-5 py-2.5 rounded-full transition-colors disabled:opacity-50"
        >
          Download a backup
        </button>
        <button
          onClick={() => restoreInput.current?.click()}
          disabled={progress !== null}
          className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#F6F1E7] transition-colors disabled:opacity-50"
        >
          Restore from a backup
        </button>
        <input
          ref={restoreInput}
          type="file"
          accept=".zip,application/zip"
          multiple
          className="hidden"
          onChange={(e) => handleRestore(Array.from(e.target.files ?? []))}
        />
        <button onClick={onOpenRecentlyDeleted} className="text-sm text-[#BB5133] hover:underline px-2">
          Recently deleted{trashCount > 0 ? ` (${trashCount})` : ''}
        </button>
      </div>

      {progress && (
        <p className="text-sm text-[#231F1B] mt-3">
          {progress.label}
          {progress.total > 0 ? ` ${progress.done} of ${progress.total}…` : '…'} Keep this page open.
        </p>
      )}
      {message && (
        <p
          className={`text-sm mt-3 rounded-xl px-3 py-2 ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
          }`}
        >
          {message.text}
        </p>
      )}

      <ul className="text-xs text-[#8A8177] mt-4 space-y-1">
        <li>{lastBackup ? `Last backup: ${dateFormat.format(new Date(lastBackup.at))} (${lastBackup.photoCount} photos)` : 'No backup yet.'}</li>
        {usage && (
          <li>
            Using {formatBytes(usage.used)} of browser storage
            {usage.quota ? ` (about ${formatBytes(usage.quota)} available)` : ''}.
          </li>
        )}
        {persisted === true && <li>This browser has agreed to keep your photos until you remove them.</li>}
        {persisted === false && <li>This browser may clear your photos to save space — keep a recent backup.</li>}
      </ul>

      {showHomeScreenTip && (
        <p className="text-xs text-[#5B5349] bg-[#F6F1E7] rounded-xl px-3 py-2 mt-4">
          <strong>On iPhone or iPad:</strong> tap Share → <em>Add to Home Screen</em> and open Tidee Moments from there.
          Safari keeps a Home Screen app's photos much more reliably than a website tab's.
        </p>
      )}
    </section>
  );
}
