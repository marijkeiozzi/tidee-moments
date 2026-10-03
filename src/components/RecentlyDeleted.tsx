import { useCallback, useEffect, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { daysUntilPurge, deletePhotosForever, getTrashedPhotos, restorePhotos, TRASH_RETENTION_DAYS } from '../db/indexedDb';
import PhotoThumbImage from './PhotoThumbImage';

interface RecentlyDeletedProps {
  onBack: () => void;
}

// Everything set aside or deleted while sorting waits here for TRASH_RETENTION_DAYS, so a
// wrong call can always be undone — then it's removed for good to free up storage.
export default function RecentlyDeleted({ onBack }: RecentlyDeletedProps) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setPhotos(await getTrashedPhotos());
    setSelected(new Set());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleRestore(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await restorePhotos(ids);
      flash(`Restored ${ids.length} photo${ids.length === 1 ? '' : 's'} to your Timeline`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteForever(ids: string[]) {
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Remove ${ids.length} photo${ids.length === 1 ? '' : 's'} from Tidee Moments for good? This can't be undone. (Your camera roll and original files aren't affected.)`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deletePhotosForever(ids);
      flash(`Removed ${ids.length} photo${ids.length === 1 ? '' : 's'}`);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const all = photos ?? [];
  const selectedIds = Array.from(selected);

  return (
    <div>
      <button onClick={onBack} className="text-sm text-[#8A8177] hover:text-[#231F1B] transition-colors mb-2">
        ← Back
      </button>
      <h2 className="font-serif text-3xl sm:text-4xl mb-2">Recently deleted</h2>
      <p className="text-sm text-[#8A8177] mb-5 max-w-2xl">
        Photos you set aside or delete wait here for {TRASH_RETENTION_DAYS} days in case you change your mind, then
        they're removed from Tidee Moments to free up space. Your camera roll and original files are never touched.
      </p>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5 bg-white border border-black/5 rounded-2xl p-3">
          {selected.size > 0 ? (
            <>
              <span className="text-sm font-semibold text-[#231F1B]">{selected.size} selected</span>
              <button
                onClick={() => handleRestore(selectedIds)}
                disabled={busy}
                className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-4 py-1.5 rounded-full disabled:opacity-40"
              >
                Restore
              </button>
              <button
                onClick={() => handleDeleteForever(selectedIds)}
                disabled={busy}
                className="text-sm text-red-700 hover:underline disabled:opacity-40"
              >
                Delete for good
              </button>
              <button onClick={() => setSelected(new Set())} className="text-sm text-[#A69C8E] hover:underline ml-auto">
                Clear selection
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-[#A69C8E]">Tap photos to select them, or:</span>
              <button
                onClick={() => handleRestore(all.map((p) => p.id))}
                disabled={busy}
                className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-4 py-1.5 rounded-full hover:bg-[#F6F1E7] disabled:opacity-40"
              >
                Restore all {all.length}
              </button>
              <button
                onClick={() => handleDeleteForever(all.map((p) => p.id))}
                disabled={busy}
                className="text-sm text-red-700 hover:underline disabled:opacity-40"
              >
                Empty now
              </button>
            </>
          )}
        </div>
      )}

      {photos === null ? null : all.length === 0 ? (
        <p className="text-[#A69C8E]">Nothing here 🌱 Photos you set aside while sorting show up here for {TRASH_RETENTION_DAYS} days.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {all.map((photo) => {
            const isSelected = selected.has(photo.id);
            const days = daysUntilPurge(photo);
            return (
              <button
                key={photo.id}
                onClick={() => toggle(photo.id)}
                className={`relative aspect-square w-full rounded-xl overflow-hidden bg-[#EFE9DD] ${isSelected ? 'ring-4 ring-[#BB5133]' : ''}`}
              >
                <PhotoThumbImage photo={photo} />
                <span className="absolute bottom-2 left-2 bg-black/55 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                  {days === 0 ? 'Removed today' : `${days} day${days === 1 ? '' : 's'} left`}
                </span>
                {isSelected && (
                  <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#BB5133] text-white text-xs flex items-center justify-center shadow">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#231F1B] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
