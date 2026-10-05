import { useEffect, useState } from 'react';
import { BACKUP_EVENT, createBackup, getLastBackup } from '../lib/backup';

const SNOOZE_KEY = 'tidee:backupReminderSnoozedUntil';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

// A gentle nudge whenever there are kept photos that aren't in a backup yet — never backed up,
// or more photos kept since the last one. "Later" hides it for a few days.
export default function BackupReminder({ keptCount }: { keptCount: number }) {
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [last, setLast] = useState(getLastBackup());

  // A backup made anywhere (e.g. the Albums tab panel) clears this reminder right away.
  useEffect(() => {
    const onBackup = () => setLast(getLastBackup());
    window.addEventListener(BACKUP_EVENT, onBackup);
    return () => window.removeEventListener(BACKUP_EVENT, onBackup);
  }, []);

  const unbacked = last ? keptCount - (last.keptCount ?? last.photoCount) : keptCount;
  if (hidden || keptCount === 0 || (unbacked <= 0 && !done) || (!done && Date.now() < snoozedUntil())) return null;

  async function backUp() {
    setProgress('Preparing…');
    try {
      const r = await createBackup((d, t) => setProgress(`Packing ${d} of ${t}…`));
      setDone(
        `Backup ready (${r.photos} photos${r.parts > 1 ? `, ${r.parts} files` : ''}). Save it from the panel, then keep it somewhere safe like iCloud Drive or Google Drive.`,
      );
    } catch (err) {
      setDone(`Backup failed: ${err instanceof Error ? err.message : String(err)} — try again from the Albums tab.`);
    } finally {
      setProgress(null);
    }
  }

  function later() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // ignore
    }
    setHidden(true);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl px-4 py-3 mb-6 text-sm">
      {done ? (
        <>
          <span className="flex-1 min-w-[200px]">{done}</span>
          <button onClick={() => setHidden(true)} className="text-amber-900 hover:underline">
            Dismiss
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 min-w-[200px]">
            <strong>
              {unbacked} kept photo{unbacked === 1 ? '' : 's'} {last ? 'since your last backup' : 'not backed up yet'}.
            </strong>{' '}
            They're only stored in this browser — a backup protects them if the browser clears its data.
          </span>
          <button
            onClick={backUp}
            disabled={progress !== null}
            className="bg-[#231F1B] hover:bg-black text-white font-medium px-4 py-2 rounded-full disabled:opacity-60"
          >
            {progress ?? 'Back up now'}
          </button>
          {!progress && (
            <button onClick={later} className="text-amber-900 hover:underline">
              Later
            </button>
          )}
        </>
      )}
    </div>
  );
}
